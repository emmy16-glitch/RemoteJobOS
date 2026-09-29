const items = [
  { label: "Overview", href: "/", icon: "⌂" },
  { label: "Jobs", href: "/jobs", icon: "⌕" },
  { label: "Applications", href: "/applications", icon: "▤" },
  { label: "Responses", href: "/inbox", icon: "✉" },
  { label: "Exceptions", href: "/exceptions", icon: "⚠" },
  { label: "CVs", href: "/cvs", icon: "◈" },
  { label: "Answers", href: "/answers", icon: "✓" },
  { label: "Analytics", href: "/analytics", icon: "▥" },
  { label: "Automation", href: "/agent", icon: "✦" },
  { label: "Settings", href: "/profile", icon: "⚙" }
];

type SidebarCounts = Partial<Record<
  "Jobs" | "Applications" | "Exceptions" | "CVs" | "Responses",
  number
>>;

export function Sidebar({
  active,
  agentHealthy = false,
  counts = {}
}: {
  active: string;
  agentHealthy?: boolean;
  counts?: SidebarCounts;
}) {
  const normalizedActive =
    active === "Dashboard" ? "Overview" :
    active === "Inbox" ? "Responses" :
    active === "Agent" ? "Automation" :
    active === "Profile" || active === "Rules" ? "Settings" :
    active;

  return (
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
        <div className="sidebarStatus">
          <span className={agentHealthy ? "dot" : "dot off"} />
          <div>
            <b>{agentHealthy ? "Automation active" : "Automation waiting"}</b>
            <small>5 workers · every 5 minutes</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
