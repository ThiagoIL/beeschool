import { DrePanel } from "@/views/app/panels";
type SP = Promise<Record<string, string | string[] | undefined>>;
export default function Page({ searchParams }: { searchParams: SP }) { return <DrePanel searchParams={searchParams} />; }
