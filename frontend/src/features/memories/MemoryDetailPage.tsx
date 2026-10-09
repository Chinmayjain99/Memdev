import { useParams } from 'react-router';
import { EmptyState } from '../../components/common/States';

export function MemoryDetailPage() {
  const { id } = useParams();
  return <><p className="eyebrow">MEMORY</p><h1>Memory detail</h1><section className="panel"><EmptyState>Memory {id} will be shown here.</EmptyState></section></>;
}
