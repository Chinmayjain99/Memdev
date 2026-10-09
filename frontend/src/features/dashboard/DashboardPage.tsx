import { EmptyState } from '../../components/common/States';

export function DashboardPage() {
  return <><div className="page-heading"><div><p className="eyebrow">YOUR SPACE</p><h1>Dashboard</h1></div></div><section className="panel"><h2>Your memories</h2><EmptyState>Your saved memories and search will appear here.</EmptyState></section></>;
}
