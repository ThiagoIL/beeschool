import { AppHome } from "@/views/app/home";

type SP = Promise<Record<string, string | undefined>>;
export default async function Inicio({ searchParams }: { searchParams: SP }) {
  return <AppHome searchParams={searchParams} />;
}
