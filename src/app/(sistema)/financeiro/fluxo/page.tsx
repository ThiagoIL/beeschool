import { CashFlowPage } from "@/views/app/finance";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <CashFlowPage searchParams={searchParams} />; }
