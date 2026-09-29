import { ThemeToggle } from "./theme-toggle";

const items = [
  { label: "Overview", href: "/", icon: "⌂" },
  { label: "Jobs", href: "/jobs", icon: "⌕" },
  { label: "Applications", href: "/applications", icon: "▤" },
  { label: "Responses", href: "/inbox", icon: "✉" },
  { label: "Exceptions", href: "/exceptions", icon: "△" },
  { label: "Sources", href: "/agent", icon: "◫" },
  { label: "AI & CV", href: "/cvs", icon: "✦" },
  { label: "Settings", href: "/profile", icon: "⚙" }
] as const;

type SidebarCounts = Partial<Record<
  "Jobs" | "Applications" | "Exceptions" | "Responses",
  number
>>;

function normalizedActiveLabel(active: string) {
  if (active === "Dashboard") return "Overview";
  if (active === "Inbox") return "Responses";
  if (active === "Agent") return "Sources";
  if (active === "CVs" || active === "Answers" || active === "Analytics") return "AI & CV";
  if (active === "Profile" || active === "Rules") return "Settings";
  return active;
}

export function Sidebar({
  active,
  agentHealthy = false,
  counts = {}
}: {
  active: string;
  agentHealthy?: boolean;
  counts?: SidebarCounts;
}) {
  const normalizedActive = normalizedActiveLabel(active);

  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="RemoteJobOS overview">
          <div className="brandMark" aria-hidden="true">
            <span className="brandHandle" />
            <span className="brandCase" />
          </div>
          <div className="brandCopy">
            <b>RemoteJobOS</b>
            <span>Find. Match. Apply. Get hired.</span>
          </div>
        </a>

        <nav className="sideNav" aria-label="Primary navigation">
          {items.map((item) => {
            const count = counts[item.label as keyof SidebarCounts];
            return (
              <a
                className={item.label === normalizedActive ? "active" : ""}
                href={item.href}
                key={item.label}
              >
                <span className="navIcon" aria-hidden="true">{item.icon}</span>
                <span className="navLabel">{item.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span className={"navBadge " + (item.label === "Exceptions" ? "alert" : "")}>
                    {count > 999 ? "999+" : count}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        <div className="sidebarFoot">
          <div className="workspaceCard">
            <span className="workspaceAvatar">R</span>
            <div>
              <b>RemoteJobOS</b>
              <small>{agentHealthy ? "Automation active" : "Automation waiting"}</small>
            </div>
            <span className={agentHealthy ? "workspaceDot online" : "workspaceDot"} aria-hidden="true" />
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <nav className="mobileNav" aria-label="Mobile primary navigation">
        {items.slice(0, 5).map((item) => {
          const count = counts[item.label as keyof SidebarCounts];
          return (
            <a
              className={item.label === normalizedActive ? "active" : ""}
              href={item.href}
              key={item.label}
            >
              <span className="mobileNavIcon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {typeof count === "number" && count > 0 ? (
                <i>{count > 99 ? "99+" : count}</i>
              ) : null}
            </a>
          );
        })}
      </nav>
    </>
  );
}
