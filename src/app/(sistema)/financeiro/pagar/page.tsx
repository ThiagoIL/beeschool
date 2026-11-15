import { TitlesPage } from "@/views/tenant/finance";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <TitlesPage kind="PAGAR" searchParams={searchParams} />; }
