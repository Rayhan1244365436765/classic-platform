/**
 * A decorative spinning roulette wheel for the "Fire Roulette" lobby tile.
 *
 * Pure SVG (no asset) plus a static ball marker. The rotation is a CSS
 * `transform` on `.fire-wheel` (compositor-only), so it stays cheap on mobile.
 */

const POCKETS = 24;
const CX = 100;
const CY = 100;
const OUTER = 97;
const HUB = 40;

/** One wedge (pocket) from the hub out to the rim, measured clockwise from 12 o'clock. */
function wedgePath(index: number): string {
  const step = (Math.PI * 2) / POCKETS;
  const a0 = index * step - Math.PI / 2;
  const a1 = (index + 1) * step - Math.PI / 2;

  const xo0 = CX + OUTER * Math.cos(a0);
  const yo0 = CY + OUTER * Math.sin(a0);
  const xo1 = CX + OUTER * Math.cos(a1);
  const yo1 = CY + OUTER * Math.sin(a1);
  const xi0 = CX + HUB * Math.cos(a0);
  const yi0 = CY + HUB * Math.sin(a0);
  const xi1 = CX + HUB * Math.cos(a1);
  const yi1 = CY + HUB * Math.sin(a1);

  return [
    `M ${xo0.toFixed(2)} ${yo0.toFixed(2)}`,
    `A ${OUTER} ${OUTER} 0 0 1 ${xo1.toFixed(2)} ${yo1.toFixed(2)}`,
    `L ${xi1.toFixed(2)} ${yi1.toFixed(2)}`,
    `A ${HUB} ${HUB} 0 0 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function FireRouletteWheel() {
  return (
    <span className="fire-wheel-wrap" aria-hidden="true">
      <svg className="fire-wheel" viewBox="0 0 200 200">
        {/* Gold outer rim. */}
        <circle cx={CX} cy={CY} r={100} fill="#f4c430" />
        <circle cx={CX} cy={CY} r={OUTER} fill="#1a0608" />

        {/* Pockets: a green zero, then alternating red and near-black. */}
        {Array.from({ length: POCKETS }, (_, i) => (
          <path
            key={i}
            d={wedgePath(i)}
            fill={i === 0 ? '#0e9a45' : i % 2 === 0 ? '#240509' : '#e2213c'}
            stroke="#f4c430"
            strokeWidth="0.6"
          />
        ))}

        {/* Center hub. */}
        <circle cx={CX} cy={CY} r={HUB} fill="#0d0305" stroke="#f4c430" strokeWidth="3" />
        <circle cx={CX} cy={CY} r={15} fill="#f4c430" />
        <circle cx={CX} cy={CY} r={6} fill="#fff" />
      </svg>

      <span className="fire-wheel__ball" />
    </span>
  );
}