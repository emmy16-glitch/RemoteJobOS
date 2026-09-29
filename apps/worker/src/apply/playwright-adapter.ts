import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import type {
  ApplicationField,
  FieldKind,
  FillPlanEntry,
  VerificationIssue,
  VerificationReport
} from "@remotejobos/core";
import type {
  ApplicationAdapter,
  ApplicationContext,
  ConfirmationResult,
  SubmitResult
} from "./types.js";

type RawField = {
  index: number;
  id: string;
  name: string;
  tag: "input" | "textarea" | "select";
  type: string;
  role: string;
  label: string;
  groupLabel: string;
  value: string;
  required: boolean;
  options: string[];
  nearbyLabel: string;
};

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: string): string {
  return compact(value).toLowerCase();
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function safeRegex(value: string): RegExp {
  const escaped = value.replace(/[.*+?^$()[\]{}|\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

function fieldKind(raw: RawField): FieldKind {
  if (raw.tag === "textarea") return "textarea";
  if (raw.tag === "select") return "select";
  if (raw.role === "combobox") return "typeahead";
  if (raw.type === "email") return "email";
  if (raw.type === "tel") return "tel";
  if (raw.type === "file") return "file";
  if (raw.type === "radio") return "radio";
  if (raw.type === "checkbox") return "checkbox";
  if (["text", "url", "number", "date", "search", ""].includes(raw.type)) return "text";
  return "unknown";
}

function isSensitive(label: string): boolean {
  return /salary|compensation|citizenship|security clearance|criminal|disability|race|ethnicity|gender|veteran|demographic|sponsorship|relocation|visa|work authorization|work permit|legally authorized/i.test(label);
}

function boolValue(value: string): boolean {
  return /^(1|true|yes|y|on)$/i.test(value.trim());
}

function semanticFieldLabel(raw: RawField): string | undefined {
  const key = `${raw.name} ${raw.id}`.toLowerCase();

  if (/candidate\.name|candidate-name/.test(key)) return "Name";
  if (/candidate\.email|candidate-email/.test(key)) return "Email";
  if (/candidate\.phone|candidate-phone/.test(key)) return "Phone";
  if (/candidate\.cv|candidate-cv|resume/.test(key)) return "Resume / CV";
  if (/candidate\.photo|candidate-photo/.test(key)) return "Profile photo";
  if (/candidate\.locations|preferred.*location/.test(key)) return "Preferred work location";

  return undefined;
}

function genericSectionLabel(value: string): boolean {
  return /^(meine daten|fragen|questions?|my data|personal information|application details)$/i.test(
    compact(value)
  );
}

function bestFieldLabel(raw: RawField): string {
  const semantic = semanticFieldLabel(raw);
  const candidates = [
    raw.groupLabel,
    raw.label,
    raw.nearbyLabel
  ].map(compact).filter(Boolean);

  const specific = candidates.find((value) => !genericSectionLabel(value));
  if (specific) return specific;
  if (semantic) return semantic;
  return candidates[0] || raw.name || raw.id || `field-${raw.index}`;
}

function checkboxGroupKey(raw: RawField): string {
  if (!raw.name) return "";
  if (!/(multiContent|locations\.value)/i.test(raw.name)) return "";
  return raw.name.replace(/-\d+(?:-\d+)?$/, "");
}

export class PlaywrightAtsAdapter implements ApplicationAdapter {
  private browser?: Browser;
  private page?: Page;

  constructor(
    public readonly name: string,
    private readonly urlPatterns: RegExp[],
    private readonly preferApplyLink = false
  ) {}

  canHandle(url: string): boolean {
    return this.urlPatterns.some((pattern) => pattern.test(url));
  }

  private controls(page: Page): Locator {
    return page.locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
  }

  private async followApplyLink(page: Page): Promise<Page> {
    const candidates = [
      page.getByRole("link", { name: /apply( for this job| now)?/i }).first(),
      page.getByRole("button", { name: /apply( for this job| now)?/i }).first(),
      page.getByRole("link", { name: /continue to application/i }).first(),
      page.getByRole("button", { name: /continue to application/i }).first()
    ];

    for (const candidate of candidates) {
      if (!(await candidate.count()) || !(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const context = page.context();
      const popupPromise = context.waitForEvent("page", { timeout: 3_000 }).catch(() => undefined);
      await candidate.click();
      const popup = await popupPromise;

      if (popup) {
        this.page = popup;
        await popup.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
        await popup.waitForTimeout(750);
        return popup;
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(750);
      return page;
    }

    return page;
  }

  private async ensurePage(context: ApplicationContext): Promise<Page> {
    if (this.page) return this.page;

    this.browser = await chromium.launch({ headless: true });
    const browserContext = await this.browser.newContext({
      viewport: { width: 1440, height: 1100 },
      locale: "en-US"
    });
    this.page = await browserContext.newPage();
    await this.page.goto(context.jobUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await this.page.waitForTimeout(500);

    let page = this.page;
    if (this.preferApplyLink || await this.controls(page).count() < 2) {
      page = await this.followApplyLink(page);
      this.page = page;
    }

    return page;
  }

  private resolve(page: Page, field: ApplicationField): Locator {
    const locator = field.locator;
    if (!locator) throw new Error("Field " + field.key + " has no stable locator");

    if (locator.strategy === "id") {
      return page.locator('[id="' + cssString(locator.value) + '"]').first();
    }

    if (locator.strategy === "name") {
      const tag = locator.tag === "other" ? "" : locator.tag;
      return page.locator(tag + '[name="' + cssString(locator.value) + '"]').first();
    }

    return this.controls(page).nth(Number(locator.value));
  }

  async scan(context: ApplicationContext): Promise<ApplicationField[]> {
    const page = await this.ensurePage(context);
    const controls = this.controls(page);

    const raw = await controls.evaluateAll((elements): RawField[] =>
      elements.map((node, index) => {
        const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const tag = element.tagName.toLowerCase() as RawField["tag"];
        const input = element as HTMLInputElement;
        const fieldset = element.closest("fieldset");
        const legend = fieldset?.querySelector("legend")?.textContent ?? "";
        const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        const directLabel =
          element.getAttribute("aria-label") ??
          element.getAttribute("placeholder") ??
          labelledBy ??
          (element as HTMLInputElement).labels?.[0]?.textContent ??
          element.getAttribute("name") ??
          element.getAttribute("id") ??
          "";

        const nearby =
          element.closest('[data-testid*="question" i], [class*="question" i], [class*="field" i], [class*="form-group" i]');
        const nearbyLabel =
          nearby?.querySelector("legend, label, [role='heading'], h1, h2, h3, h4")?.textContent ?? "";

        return {
          index,
          id: element.id ?? "",
          name: element.getAttribute("name") ?? "",
          tag,
          type: tag === "input" ? (input.type ?? "text").toLowerCase() : "",
          role: element.getAttribute("role") ?? "",
          label: (directLabel ?? "").replace(/\s+/g, " ").trim(),
          groupLabel: (legend ?? "").replace(/\s+/g, " ").trim(),
          value: tag === "input" ? (input.value ?? "") : "",
          required:
            element.hasAttribute("required") ||
            element.getAttribute("aria-required") === "true",
          options:
            tag === "select"
              ? Array.from((element as HTMLSelectElement).options)
                  .map((option) => (option.label || option.textContent || option.value).trim())
                  .filter(Boolean)
              : [],
          nearbyLabel: (nearbyLabel ?? "").replace(/\s+/g, " ").trim()
        };
      })
    );

    const hasApplicationForm =
      (await page.locator("form").count()) > 0 ||
      (await page.locator('input[type="file"]').count()) > 0 ||
      (await page.getByRole("button", { name: /apply|submit|continue|next/i }).count()) > 0;

    if (!raw.length || !hasApplicationForm) {
      throw new Error(
        "No usable application form was found after following the job's Apply link"
      );
    }

    const fields: ApplicationField[] = [];
    const radioGroups = new Map<string, RawField[]>();
    const checkboxGroups = new Map<string, RawField[]>();

    for (const item of raw) {
      if (item.type !== "checkbox") continue;
      const key = checkboxGroupKey(item);
      if (!key) continue;
      const group = checkboxGroups.get(key) ?? [];
      group.push(item);
      checkboxGroups.set(key, group);
    }

    const emittedCheckboxGroups = new Set<string>();

    for (const item of raw) {
      if (item.type === "radio" && item.name) {
        const group = radioGroups.get(item.name) ?? [];
        group.push(item);
        radioGroups.set(item.name, group);
        continue;
      }

      if (item.type === "checkbox") {
        const groupKey = checkboxGroupKey(item);
        const group = groupKey ? checkboxGroups.get(groupKey) : undefined;
        if (group && group.length > 1) {
          if (emittedCheckboxGroups.has(groupKey)) continue;
          emittedCheckboxGroups.add(groupKey);

          const label = bestFieldLabel(group[0]!);
          const options = group
            .map((entry) => compact(entry.label || entry.value || entry.id))
            .filter((value, index, all) => value && all.indexOf(value) === index);

          fields.push({
            key: "checkbox-group:" + groupKey,
            label,
            kind: "multi-select",
            required: group.some((entry) => entry.required),
            options: options.length ? options : undefined,
            sensitive: isSensitive(label)
          });
          continue;
        }
      }

      const label = bestFieldLabel(item);
      fields.push({
        key: item.id || item.name || "dom:" + item.index,
        label,
        kind: fieldKind(item),
        required: item.required,
        options: item.options.length ? item.options : undefined,
        sensitive: isSensitive(label),
        locator: item.id
          ? { strategy: "id", value: item.id, tag: item.tag }
          : item.name
            ? { strategy: "name", value: item.name, tag: item.tag }
            : { strategy: "index", value: String(item.index), tag: item.tag }
      });
    }

    for (const [name, group] of radioGroups) {
      const first = group[0]!;
      const label = bestFieldLabel(first);
      fields.push({
        key: "radio:" + name,
        label,
        kind: "radio",
        required: group.some((item) => item.required),
        options: group.map((item) => compact(item.label || item.value)).filter(Boolean),
        sensitive: isSensitive(label),
        locator: { strategy: "name", value: name, tag: "input" }
      });
    }

    return fields;
  }

  private async fillRadio(page: Page, field: ApplicationField, value: string): Promise<void> {
    const name = field.locator?.strategy === "name" ? field.locator.value : "";
    if (!name) throw new Error("Radio field " + field.key + " is missing a name locator");

    const radios = page.locator('input[type="radio"][name="' + cssString(name) + '"]');
    const wanted = normalized(value);
    const count = await radios.count();

    for (let i = 0; i < count; i += 1) {
      const radio = radios.nth(i);
      const optionValue = normalized(await radio.getAttribute("value") ?? "");
      const optionLabel = normalized(await radio.evaluate((element) => {
        const input = element as HTMLInputElement;
        return input.labels?.[0]?.textContent ?? "";
      }));

      if (optionValue === wanted || optionLabel === wanted || optionLabel.includes(wanted)) {
        await radio.check();
        return;
      }
    }

    throw new Error('No radio option matched "' + value + '" for ' + field.label);
  }

  async fill(context: ApplicationContext, plan: FillPlanEntry[]): Promise<void> {
    const page = await this.ensurePage(context);

    for (const entry of plan) {
      if (entry.action.type === "skip" || entry.action.type === "human-review") continue;
      const locator = this.resolve(page, entry.field);

      if (entry.action.type === "upload") {
        const filePath = context.assets?.[entry.action.assetKey];
        if (!filePath) throw new Error("Verified asset missing: " + entry.action.assetKey);
        await locator.setInputFiles(filePath);
        continue;
      }

      if (entry.action.type === "decline") {
        if (entry.field.kind === "select") {
          const decline = entry.field.options?.find((option) => /decline|prefer not|do not wish/i.test(option));
          if (!decline) throw new Error("No decline option found for " + entry.field.label);
          await locator.selectOption({ label: decline });
          continue;
        }
        throw new Error("Cannot safely decline field " + entry.field.label);
      }

      const value = entry.action.value;

      if (entry.field.kind === "select") {
        try {
          await locator.selectOption({ label: value });
        } catch {
          await locator.selectOption({ value });
        }
      } else if (entry.field.kind === "checkbox") {
        if (boolValue(value)) await locator.check();
        else await locator.uncheck();
      } else if (entry.field.kind === "radio") {
        await this.fillRadio(page, entry.field, value);
      } else if (entry.field.kind === "typeahead") {
        await locator.fill(value);
        await page.waitForTimeout(350);
        const option = page.getByRole("option", { name: safeRegex(value) }).first();
        if (await option.count() && await option.isVisible().catch(() => false)) {
          await option.click();
        }
      } else {
        await locator.fill(value);
      }
    }
  }

  async verify(context: ApplicationContext, plan: FillPlanEntry[]): Promise<VerificationReport> {
    const page = await this.ensurePage(context);
    const issues: VerificationIssue[] = [];

    const captcha = page.locator(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey], [class*="captcha" i]'
    );
    if (await captcha.count()) {
      issues.push({
        fieldKey: "captcha",
        code: "unverified",
        message: "CAPTCHA or anti-bot challenge detected; human review is required"
      });
    }

    let verifiedFieldCount = 0;
    const verifiable = plan.filter((entry) =>
      entry.action.type === "fill" || entry.action.type === "upload" || entry.action.type === "decline"
    );

    for (const entry of verifiable) {
      const locator = this.resolve(page, entry.field);

      try {
        if (entry.action.type === "upload") {
          const actual = await locator.inputValue();
          if (!actual) {
            issues.push({ fieldKey: entry.field.key, code: "empty-required", message: "File upload is empty" });
          } else {
            verifiedFieldCount += 1;
          }
          continue;
        }

        if (entry.action.type === "decline") {
          const actual = normalized(await locator.inputValue());
          if (!/decline|prefer not|do not wish/.test(actual)) {
            issues.push({ fieldKey: entry.field.key, code: "value-mismatch", message: "Decline choice was not retained" });
          } else {
            verifiedFieldCount += 1;
          }
          continue;
        }

        if (entry.action.type !== "fill") {
          issues.push({
            fieldKey: entry.field.key,
            code: "unverified",
            message: "Verification reached an unsupported plan action"
          });
          continue;
        }

        const expected = entry.action.value;

        if (entry.field.kind === "checkbox") {
          const checked = await locator.isChecked();
          if (checked !== boolValue(expected)) {
            issues.push({ fieldKey: entry.field.key, code: "value-mismatch", message: "Checkbox state does not match plan" });
          } else {
            verifiedFieldCount += 1;
          }
        } else if (entry.field.kind === "radio") {
          const name = entry.field.locator?.value ?? "";
          const checked = page.locator('input[type="radio"][name="' + cssString(name) + '"]:checked');
          if (!(await checked.count())) {
            issues.push({ fieldKey: entry.field.key, code: "empty-required", message: "No radio option is selected" });
          } else {
            verifiedFieldCount += 1;
          }
        } else {
          const actual = await locator.inputValue();
          const expectedNormalized = entry.field.kind === "tel"
            ? expected.replace(/\D/g, "")
            : normalized(expected);
          const actualNormalized = entry.field.kind === "tel"
            ? actual.replace(/\D/g, "")
            : normalized(actual);

          if (!actualNormalized || actualNormalized !== expectedNormalized) {
            issues.push({
              fieldKey: entry.field.key,
              code: "value-mismatch",
              message: 'DOM value for "' + entry.field.label + '" does not match the verified plan'
            });
          } else {
            verifiedFieldCount += 1;
          }
        }
      } catch (error) {
        issues.push({
          fieldKey: entry.field.key,
          code: "unverified",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      verifiedFieldCount,
      totalFieldCount: verifiable.length
    };
  }

  private async findSubmitControl(page: Page): Promise<Locator | undefined> {
    const conventional = page.locator(
      'form button[type="submit"]:visible, form input[type="submit"]:visible'
    );
    const conventionalCount = await conventional.count();
    if (conventionalCount === 1) return conventional.first();

    const controls = page.locator(
      'form button:visible, form input[type="button"]:visible, form input[type="submit"]:visible'
    );
    const matches: number[] = [];
    const count = await controls.count();
    const positive =
      /submit|submit application|apply|apply now|send application|send|bewerben|jetzt bewerben|bewerbung absenden|absenden|senden|postuler|candidater/i;
    const negative = /save|draft|back|previous|cancel|next|continue|preview/i;

    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const text = compact(
        [
          await control.textContent().catch(() => ""),
          await control.getAttribute("value").catch(() => ""),
          await control.getAttribute("aria-label").catch(() => ""),
          await control.getAttribute("title").catch(() => "")
        ].filter(Boolean).join(" ")
      );
      if (positive.test(text) && !negative.test(text)) {
        matches.push(index);
      }
    }

    if (matches.length === 1) return controls.nth(matches[0]!);

    const roleMatch = page.getByRole("button", {
      name: /submit application|submit|apply now|apply|send application|bewerben|jetzt bewerben|bewerbung absenden|absenden|senden|postuler|candidater/i
    });
    const visibleRoleMatches: number[] = [];
    const roleCount = await roleMatch.count();
    for (let index = 0; index < roleCount; index += 1) {
      if (await roleMatch.nth(index).isVisible().catch(() => false)) {
        visibleRoleMatches.push(index);
      }
    }
    if (visibleRoleMatches.length === 1) {
      return roleMatch.nth(visibleRoleMatches[0]!);
    }

    return undefined;
  }

  async prepareSubmit(context: ApplicationContext) {
    const page = await this.ensurePage(context);

    if (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]').count()) {
      return {
        ready: false,
        retryable: false,
        reason: "CAPTCHA detected; RemoteJobOS will not bypass it"
      };
    }

    const submit = await this.findSubmitControl(page);

    if (!submit || !(await submit.isVisible().catch(() => false))) {
      return {
        ready: false,
        retryable: true,
        reason: "No unambiguous visible submit control was found"
      };
    }

    if (await submit.isDisabled().catch(() => false)) {
      return {
        ready: false,
        retryable: true,
        reason: "Submit control is present but temporarily disabled"
      };
    }

    return { ready: true, retryable: false };
  }

  async submit(context: ApplicationContext): Promise<SubmitResult> {
    const page = await this.ensurePage(context);

    const submit = await this.findSubmitControl(page);

    if (!submit || !(await submit.isVisible().catch(() => false))) {
      return {
        submitted: false,
        sideEffectStarted: false,
        retryable: true,
        url: page.url(),
        message: "Submit control disappeared before the click"
      };
    }

    if (await submit.isDisabled().catch(() => false)) {
      return {
        submitted: false,
        sideEffectStarted: false,
        retryable: true,
        url: page.url(),
        message: "Submit control became disabled before the click"
      };
    }

    try {
      await submit.click();
    } catch (error) {
      return {
        submitted: false,
        sideEffectStarted: true,
        retryable: false,
        url: page.url(),
        message:
          "Submit click returned an error after dispatch may have started: " +
          (error instanceof Error ? error.message : String(error))
      };
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    return {
      submitted: true,
      sideEffectStarted: true,
      retryable: false,
      url: page.url()
    };
  }

  async confirm(context: ApplicationContext): Promise<ConfirmationResult> {
    const page = await this.ensurePage(context);
    await page.waitForTimeout(800);

    const url = page.url();
    const body = compact((await page.locator("body").innerText().catch(() => "")).slice(0, 20_000));
    const confirmed =
      /thank you for applying|thanks for applying|application (has been )?(received|submitted)|successfully submitted|we received your application/i.test(body) ||
      /thank-?you|confirmation|application-submitted|submitted/i.test(url);

    return {
      confirmed,
      url,
      evidence: confirmed ? body.slice(0, 500) : "No known confirmation marker found"
    };
  }

  async screenshot(context: ApplicationContext, label: string): Promise<string | undefined> {
    const page = await this.ensurePage(context);
    const directory = path.resolve("artifacts", "screenshots");
    await mkdir(directory, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    const filename = path.join(directory, context.applicationId + "-" + safeLabel + ".png");
    await page.screenshot({ path: filename, fullPage: true });
    return filename;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.page = undefined;
    this.browser = undefined;
  }
}
