import { TitlesPage } from "@/views/app/finance";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <TitlesPage kind="RECEBER" searchParams={searchParams} />; }
