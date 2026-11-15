// Dados de DEMONSTRAÇÃO (turmas, responsáveis, alunos e movimentos de set–nov) no primeiro cliente.
// Uso: DEMO=1 node scripts/seed-demo.mjs   (com DEMO_RESET=1 apaga antes os lançamentos, alunos e turmas do cliente)
// Precisa que o cliente já tenha aberto o sistema uma vez (cria empresas, contas e o plano de contas da DRE).
import { pool, newId } from "./_common.mjs";

if (process.env.DEMO !== "1") { console.error("Defina DEMO=1 para confirmar (só para ambiente de teste)."); process.exit(1); }
const db = pool();
const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
try {
  const { rows: [t] } = await db.query("select id from tenants order by created_at limit 1");
  if (!t) throw new Error("nenhum cliente cadastrado");
  const T = t.id;
  const one = async (q, p) => (await db.query(q, p)).rows[0];
  const all = async (q, p) => (await db.query(q, p)).rows;
  const comps = await all("select id, name from companies where tenant_id = $1", [T]);
  if (!comps.length) throw new Error("abra o sistema uma vez para criar os cadastros padrão");
  const school = comps.find((c) => c.name === "Bee School") ?? comps[0];
  const light = comps.find((c) => c.name === "Bee Light") ?? comps[0];
  const accs = await all("select id, name, company_id from bank_accounts where tenant_id = $1", [T]);
  const cat = async (n) => (await one("select id from fin_categories where tenant_id = $1 and name = $2", [T, n]))?.id ?? null;

  if (process.env.DEMO_RESET === "1") {
    await db.query("delete from fin_titles where tenant_id = $1", [T]);
    await db.query("delete from fin_imports where tenant_id = $1", [T]);
    await db.query("delete from bank_entries where tenant_id = $1", [T]);
    await db.query("delete from students where tenant_id = $1", [T]);
    await db.query("delete from classes where tenant_id = $1", [T]);
    await db.query("delete from people where tenant_id = $1", [T]);
  }

  // turmas, responsáveis e alunos
  const turmas = [];
  for (const [n, lv] of [["Infantil 3 A", "Educação Infantil"], ["Infantil 5 A", "Educação Infantil"], ["1º ano A", "Ensino Fundamental I"], ["3º ano A", "Ensino Fundamental I"], ["5º ano A", "Ensino Fundamental I"]]) {
    const id = newId(); turmas.push(id);
    await db.query("insert into classes (id, tenant_id, company_id, name, level, shift, year, capacity) values ($1,$2,$3,$4,$5,'Manhã',2026,20)", [id, T, school.id, n, lv]);
  }
  const nomes = ["Enzo Boa Ventura", "Bella Costa", "Rafael de Melo", "Clara Lobo", "Sara Santana", "Aurora Cardim", "Nathan Rosh", "Helena Flavia", "Calebe de Melo", "Mateus Cavalcante", "Liz Andrade", "Heloisa Colaço", "Maria Clara", "Mariana Palitot", "Leticia Ribeiro", "Isaque Prudencio"];
  for (const n of nomes) {
    const g = newId();
    await db.query("insert into people (id, tenant_id, name, kinds, phone) values ($1,$2,$3,'{\"Responsável financeiro\"}',$4)", [g, T, `Resp. de ${n.split(" ")[0]}`, `(83) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`]);
    const fee = pick([890, 950, 1100, 1250]);
    await db.query("insert into students (id, tenant_id, company_id, name, class_id, guardian_id, monthly_fee, discount, due_day) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [newId(), T, school.id, n, pick(turmas), g, fee, pick([0, 0, 0, 50, 100]), pick([5, 10, 10, 15])]);
  }

  // movimentos realizados set–nov (mesma estrutura das planilhas por banco)
  const plan = [
    ["Recebimentos de mensalidade", "RECEBER", 60000, 75000, 8], ["Matrícula", "RECEBER", 800, 3500, 3], ["Recebimento com eventos", "RECEBER", 300, 1500, 3],
    ["Recebimento da cantina", "RECEBER", 50, 400, 4], ["Recebimento de fardamento", "RECEBER", 200, 600, 2],
    ["Simples Nacional", "PAGAR", 9000, 11000, 1], ["Tarifas bancárias", "PAGAR", 40, 120, 2], ["Despesas com a cantina", "PAGAR", 600, 1800, 3],
    ["Material uso e consumo", "PAGAR", 300, 1200, 2], ["Despesa com deslocamento", "PAGAR", 200, 700, 2], ["Marketing", "PAGAR", 500, 2500, 1],
    ["Despesas com material didático", "PAGAR", 300, 1200, 1], ["Despesas diversas", "PAGAR", 100, 900, 4], ["Salários e ordenados", "PAGAR", 18000, 23000, 2],
    ["Pró-labore", "PAGAR", 4000, 5000, 1], ["FGTS", "PAGAR", 1800, 2300, 1], ["Honorários contábeis", "PAGAR", 700, 900, 1],
    ["Aluguéis de imóveis", "PAGAR", 8800, 9400, 1], ["Energia elétrica", "PAGAR", 1100, 1900, 1], ["Água e esgoto", "PAGAR", 300, 800, 1],
    ["Manutenção e reparos", "PAGAR", 200, 1500, 1], ["Material de higiene e limpeza", "PAGAR", 600, 1200, 1], ["Despesas com sistemas", "PAGAR", 400, 600, 1],
    ["Aplicação financeira", "PAGAR", 5000, 15000, 1],
  ];
  let n = 0;
  for (const company of [school, light]) {
    const cAccs = accs.filter((a) => a.company_id === company.id);
    if (!cAccs.length) continue;
    const scale = company === school ? 1 : 0.35;
    for (const month of ["2026-09", "2026-10", "2026-11"]) {
      const lastDay = month === "2026-11" ? 14 : 28;
      for (const [catName, kind, lo, hi, times] of plan) {
        const c = await cat(catName);
        for (let i = 0; i < times; i++) {
          const v = Math.round(rnd(lo, hi) * scale / times * 100) / 100;
          const day = String(1 + Math.floor(Math.random() * lastDay)).padStart(2, "0");
          const d = `${month}-${day}`;
          await db.query(`insert into fin_titles (id, tenant_id, kind, company_id, description, category_id, issue_date, due_date, amount, status, paid_at, paid_amount, bank_account_id, origin_type, invoice)
            values ($1,$2,$3,$4,$5,$6,$7,$7,$8,'PAGO',$7,$8,$9,'MANUAL',$10)`, [newId(), T, kind, company.id, catName, c, d, v, pick(cAccs).id, kind === "PAGAR" ? pick(["COM", "SEM", null]) : null]);
          n++;
        }
      }
    }
    // contas em aberto (a pagar e a receber)
    for (const [catName, kind, v, due] of [["Aluguéis de imóveis", "PAGAR", 9000, "2026-12-05"], ["Energia elétrica", "PAGAR", 1500, "2026-11-20"], ["Salários e ordenados", "PAGAR", 21000, "2026-12-05"], ["Simples Nacional", "PAGAR", 10200, "2026-11-12"], ["Matrícula", "RECEBER", 1727, "2026-11-25"]]) {
      await db.query(`insert into fin_titles (id, tenant_id, kind, company_id, description, category_id, issue_date, due_date, amount, status, origin_type) values ($1,$2,$3,$4,$5,$6,'2026-11-01',$7,$8,'ABERTO','MANUAL')`,
        [newId(), T, kind, company.id, catName, await cat(catName), due, Math.round(v * scale * 100) / 100]);
    }
  }
  console.log(`[demo] ${nomes.length} alunos, ${turmas.length} turmas e ${n} movimentos criados.`);
} catch (err) {
  console.error("[demo] falhou:", err.message); process.exitCode = 1;
} finally {
  await db.end();
}
