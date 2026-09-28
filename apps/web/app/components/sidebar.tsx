const items = [
  { label: "Dashboard", href: "/", icon: "⌂" },
  { label: "Jobs", href: "/jobs", icon: "⌕" },
  { label: "Applications", href: "/applications", icon: "▤" },
  { label: "Exceptions", href: "/exceptions", icon: "!" },
  { label: "CVs", href: "/cvs", icon: "▧" },
  { label: "Answers", href: "/answers", icon: "✓" },
  { label: "Inbox", href: "/inbox", icon: "✉" },
  { label: "Analytics", href: "/analytics", icon: "▥" },
  { label: "Automation", href: "/agent", icon: "✦" },
  { label: "Settings", href: "/profile", icon: "⚙" }
];

type SidebarCounts = Partial<Record<
  "Jobs" | "Applications" | "Exceptions" | "CVs" | "Inbox",
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
    active === "Overview" ? "Dashboard" :
    active === "Agent" ? "Automation" :
    active === "Profile" || active === "Rules" ? "Settings" :
    active;

  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="RemoteJobOS dashboard">
        <div className="brandMark" aria-hidden="true">
          <span className="brandHandle" />
          <span className="brandCase" />
        </div>
        <div>
          <b>RemoteJobOS</b>
          <span>Find. Apply. Get Hired. Automatically.</span>
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
                <span
                  className={
                    "navBadge " +
                    (item.label === "Exceptions" || item.label === "Inbox"
                      ? "alert"
                      : "")
                  }
                >
                  {count > 99 ? "99+" : count}
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
            <b>{agentHealthy ? "Automation running" : "Automation waiting"}</b>
            <small>Auto-except · cloud workers</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
