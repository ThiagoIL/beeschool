import { AppUser } from "@/views/app/user";

export default async function Usuario({ params }: { params: Promise<{ id: string }> }) {
  return <AppUser id={(await params).id} />;
}
