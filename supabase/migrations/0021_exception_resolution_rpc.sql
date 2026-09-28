create or replace function public.resolve_own_application_exception(
  p_exception_id uuid,
  p_action text,
  p_answer text default null,
  p_reuse_policy text default 'always'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exception public.application_exceptions%rowtype;
  v_application public.applications%rowtype;
  v_profile public.career_profiles%rowtype;
  v_answer_key text;
  v_open_count integer;
  v_approval public.agent_approvals%rowtype;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'authentication-required';
  end if;

  select e.*
    into v_exception
  from public.application_exceptions e
  join public.applications a on a.id = e.application_id
  join public.career_profiles p on p.id = a.profile_id
  where e.id = p_exception_id
    and p.owner_id = v_uid
  for update of e;

  if not found then
    raise exception 'exception-not-found';
  end if;

  select *
    into v_application
  from public.applications
  where id = v_exception.application_id
  for update;

  select *
    into v_profile
  from public.career_profiles
  where id = v_application.profile_id
    and owner_id = v_uid;

  if v_exception.status <> 'open' then
    return jsonb_build_object('status', v_exception.status, 'alreadyResolved', true);
  end if;

  if p_action = 'answer' then
    if v_exception.exception_type not in ('missing-answer','sensitive-answer') then
      raise exception 'answer-not-supported-for-exception';
    end if;

    if p_answer is null or btrim(p_answer) = '' then
      raise exception 'answer-required';
    end if;

    if p_reuse_policy not in ('always','ask','never') then
      raise exception 'invalid-reuse-policy';
    end if;

    v_answer_key := coalesce(nullif(v_exception.field_label,''), nullif(v_exception.field_key,''));
    if v_answer_key is null then
      raise exception 'answer-key-missing';
    end if;

    update public.applications
    set answers = coalesce(answers, '{}'::jsonb) || jsonb_build_object(v_answer_key, btrim(p_answer)),
        updated_at = v_now
    where id = v_application.id;

    if p_reuse_policy <> 'never' then
      insert into public.answer_vault(
        profile_id, answer_key, label, answer_value, reuse_policy, sensitive, aliases, updated_at
      )
      values (
        v_profile.id,
        v_answer_key,
        coalesce(nullif(v_exception.field_label,''), v_answer_key),
        btrim(p_answer),
        p_reuse_policy,
        v_exception.exception_type = 'sensitive-answer',
        case
          when v_exception.field_key is not null and v_exception.field_key <> v_answer_key
            then jsonb_build_array(v_exception.field_key)
          else '[]'::jsonb
        end,
        v_now
      )
      on conflict (profile_id, answer_key)
      do update set
        label = excluded.label,
        answer_value = excluded.answer_value,
        reuse_policy = excluded.reuse_policy,
        sensitive = excluded.sensitive,
        aliases = excluded.aliases,
        updated_at = excluded.updated_at;
    end if;

    update public.application_exceptions
    set status = 'resolved',
        resolution = jsonb_build_object(
          'action','answer',
          'reusePolicy',p_reuse_policy,
          'answeredAt',v_now
        ),
        resolved_at = v_now,
        updated_at = v_now
    where id = v_exception.id;

    select count(*)
      into v_open_count
    from public.application_exceptions
    where application_id = v_application.id
      and status = 'open';

    if v_open_count = 0 then
      if v_exception.run_id is not null then
        update public.agent_runs
        set status = 'pending',
            mode = 'dry-run',
            phase = 'context',
            recovery_strategy = 'safe-restart',
            last_error = null,
            completed_at = null,
            updated_at = v_now
        where id = v_exception.run_id
          and application_id = v_application.id;
      end if;

      insert into public.agent_tasks(
        task_type,payload,status,priority,max_attempts,idempotency_key,available_at
      )
      values (
        'application-review',
        jsonb_build_object(
          'applicationId',v_application.id,
          'runId',v_exception.run_id,
          'exceptionId',v_exception.id
        ),
        'pending',35,3,
        'application-review-resume:' || v_exception.id::text,
        v_now
      )
      on conflict (idempotency_key) do nothing;

      update public.applications
      set status = 'cv-prepared',
          next_action = 'Exception resolved. Application verification is queued to resume.',
          updated_at = v_now
      where id = v_application.id;
    end if;

    return jsonb_build_object('status','resolved','resumed',v_open_count = 0);

  elsif p_action = 'retry' then
    if v_exception.exception_type not in ('submit-uncertain','retry-exhausted') then
      raise exception 'retry-not-supported-for-exception';
    end if;

    if v_application.submitted_at is not null or v_application.confirmation_verified_at is not null then
      raise exception 'application-already-confirmed-submitted';
    end if;

    if v_application.submission_fenced_at is not null then
      if v_application.last_attempt_id is null then
        raise exception 'submission-fence-missing-attempt';
      end if;

      update public.applications
      set submission_fenced_at = null,
          updated_at = v_now
      where id = v_application.id
        and last_attempt_id = v_application.last_attempt_id
        and submitted_at is null
        and confirmation_verified_at is null;

      if not found then
        raise exception 'submission-fence-could-not-be-released';
      end if;
    end if;

    if v_exception.run_id is null then
      raise exception 'durable-run-missing';
    end if;

    select *
      into v_approval
    from public.agent_approvals
    where run_id = v_exception.run_id
      and application_id = v_application.id
      and approval_type = 'submit-application'
      and status in ('approved','executed')
    order by requested_at desc
    limit 1;

    if not found then
      raise exception 'approved-submission-authorization-missing';
    end if;

    update public.agent_runs
    set status = 'pending',
        mode = 'submit',
        phase = 'fence',
        recovery_strategy = 'safe-restart',
        last_error = null,
        submit_attempts = 0,
        completed_at = null,
        updated_at = v_now
    where id = v_exception.run_id
      and application_id = v_application.id;

    insert into public.agent_tasks(
      task_type,payload,status,priority,max_attempts,idempotency_key,available_at
    )
    values (
      'application-auto-submit',
      jsonb_build_object(
        'applicationId',v_application.id,
        'runId',v_exception.run_id,
        'approvalId',v_approval.id,
        'exceptionId',v_exception.id
      ),
      'pending',25,3,
      'application-exception-retry:' || v_exception.id::text,
      v_now
    )
    on conflict (idempotency_key) do nothing;

    update public.application_exceptions
    set status = 'resolved',
        resolution = jsonb_build_object(
          'action','retry',
          'confirmedNotSubmitted',true,
          'retriedAt',v_now
        ),
        resolved_at = v_now,
        updated_at = v_now
    where id = v_exception.id;

    update public.applications
    set status = 'auto-submit-queued',
        next_action = 'You confirmed it was not submitted. A safe retry is queued.',
        updated_at = v_now
    where id = v_application.id;

    return jsonb_build_object('status','resolved','retryQueued',true);

  elsif p_action = 'mark-submitted' then
    update public.applications
    set status = 'applied',
        submitted_at = coalesce(submitted_at, v_now),
        confirmation_verified_at = v_now,
        next_action = 'Submission manually confirmed from the Exception Center.',
        updated_at = v_now
    where id = v_application.id;

    if v_exception.run_id is not null then
      update public.agent_runs
      set status = 'completed',
          phase = 'finalize',
          recovery_strategy = 'already-complete',
          result = jsonb_build_object(
            'terminal','submitted',
            'verified',true,
            'reason','User manually confirmed the application was submitted'
          ),
          completed_at = v_now,
          updated_at = v_now
      where id = v_exception.run_id
        and application_id = v_application.id;

      update public.agent_approvals
      set status = 'executed',
          executed_at = v_now
      where run_id = v_exception.run_id
        and application_id = v_application.id
        and status = 'approved';
    end if;

    update public.application_exceptions
    set status = 'resolved',
        resolution = jsonb_build_object('action','mark-submitted','confirmedAt',v_now),
        resolved_at = v_now,
        updated_at = v_now
    where id = v_exception.id;

    insert into public.notification_outbox(
      owner_id,application_id,exception_id,kind,subject,body_text,status,dedupe_key
    )
    values (
      v_uid,
      v_application.id,
      v_exception.id,
      'submitted',
      'RemoteJobOS: application manually confirmed',
      'You confirmed from the Exception Center that this application was submitted. RemoteJobOS marked it as applied and will continue lifecycle tracking.',
      'pending',
      'manual-submitted:' || v_application.id::text
    )
    on conflict (dedupe_key) do nothing;

    return jsonb_build_object('status','resolved','markedSubmitted',true);

  elsif p_action = 'dismiss' then
    update public.application_exceptions
    set status = 'dismissed',
        resolution = jsonb_build_object('action','dismiss','dismissedAt',v_now),
        resolved_at = v_now,
        updated_at = v_now
    where id = v_exception.id;

    update public.applications
    set next_action = 'Exception dismissed. No automatic action was taken.',
        updated_at = v_now
    where id = v_application.id;

    return jsonb_build_object('status','dismissed');

  else
    raise exception 'unsupported-exception-action';
  end if;
end;
$$;

revoke execute on function public.resolve_own_application_exception(uuid,text,text,text)
  from public, anon;
grant execute on function public.resolve_own_application_exception(uuid,text,text,text)
  to authenticated;
