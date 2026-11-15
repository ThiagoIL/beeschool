import { StatementPage } from "@/views/tenant/finance";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <StatementPage searchParams={searchParams} />; }
