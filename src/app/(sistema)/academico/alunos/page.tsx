import { SimplePage } from "@/views/simple-page";
import { Icon } from "@/components/Icon";
export default function Page() {
  return <SimplePage k="alunos" note={<p style={{ marginTop: 12 }}><a className="btn" href="/api/export/acad-alunos"><Icon name="download" size={16} /> Exportar alunos (CSV)</a></p>} />;
}
