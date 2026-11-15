/** Marca do sistema: favo (hexágono dourado) + "Bee School", como nas logos das escolas. */
export const BRAND = { gold: "#E9AE20", black: "#1A1A1A", gray: "#808080" };

export function LogoSymbol({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 2.5l15.2 8.75v17.5L20 37.5 4.8 28.75v-17.5z" fill="none" stroke={BRAND.gold} strokeWidth={3.2} strokeLinejoin="round" />
      <ellipse cx="20" cy="21" rx="6.2" ry="7.4" fill={BRAND.gold} />
      <path d="M14.2 19h11.6M14 23h12" stroke={BRAND.black} strokeWidth={1.9} />
      <ellipse cx="15.2" cy="13.6" rx="3.6" ry="2.4" fill="#CFE3EE" transform="rotate(-25 15.2 13.6)" />
      <ellipse cx="24.8" cy="13.6" rx="3.6" ry="2.4" fill="#CFE3EE" transform="rotate(25 24.8 13.6)" />
    </svg>
  );
}

export function LogoLockup({ dark = false }: { dark?: boolean }) {
  return (
    <span className="lockup" aria-label="Bee School">
      <LogoSymbol size={32} />
      <span className="lk-t"><b style={{ color: dark ? "#FFFFFF" : BRAND.black }}>Bee School</b><small>Visão financeira</small></span>
    </span>
  );
}
