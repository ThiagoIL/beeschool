import { DrePanel } from "@/views/tenant/panels";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <DrePanel searchParams={searchParams} />; }
