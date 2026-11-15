import { IndicatorsPanel } from "@/views/app/panels";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <IndicatorsPanel searchParams={searchParams} />; }
