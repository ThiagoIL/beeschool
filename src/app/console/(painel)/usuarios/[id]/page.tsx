import { AdminUser } from "@/views/admin/user";

export default async function Usuario({ params }: { params: Promise<{ id: string }> }) {
  return <AdminUser id={(await params).id} />;
}
