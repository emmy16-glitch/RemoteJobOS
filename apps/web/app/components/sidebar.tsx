const items = [
  { label: "Overview", href: "/" },
  { label: "Jobs", href: "/jobs" },
  { label: "Applications", href: "/applications" },
  { label: "Exceptions", href: "/exceptions" },
  { label: "CVs", href: "/cvs" },
  { label: "Answers", href: "/answers" },
  { label: "Inbox", href: "/inbox" },
  { label: "Analytics", href: "/analytics" },
  { label: "Agent", href: "/agent" },
  { label: "Rules", href: "/rules" },
  { label: "Profile", href: "/profile" }
];

export function Sidebar({
  active,
  agentHealthy = false
}: {
  active: string;
  agentHealthy?: boolean;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">R</div>
        <div>
          <b>RemoteJobOS</b>
          <span>Control center</span>
        </div>
      </div>

      <nav>
        {items.map((item) => (
          <a
            className={item.label === active ? "active" : ""}
            href={item.href}
            key={item.label}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="sidebarFoot">
        <span className={agentHealthy ? "dot" : "dot off"} />
        {agentHealthy ? "Cloud agent healthy" : "Cloud agent"}
        <small>Remote-only · AI optional</small>
      </div>
    </aside>
  );
}
