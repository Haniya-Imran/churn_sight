/** A real 3D podium built from stacked CSS discs (lies on the scene floor). */
export function Podium({ size = 420, layers = 7, glow = true }: { size?: number; layers?: number; glow?: boolean }) {
  return (
    <div className="podium" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: layers }, (_, i) => (
        <span
          key={i}
          className="podium-layer"
          style={{
            transform: `translateZ(${i * 4}px)`,
            background: i === layers - 1 ? undefined : `hsl(231 ${52 + i * 2}% ${30 + i * 4}%)`,
          }}
          data-top={i === layers - 1 ? "true" : undefined}
        />
      ))}
      <span className="podium-inner" style={{ transform: `translateZ(${layers * 4 + 1}px)` }} />
      {glow && <span className="podium-glow" style={{ transform: `translateZ(${layers * 2}px)` }} />}
    </div>
  );
}

/** A thick 3D pie built from stacked conic-gradient discs. */
export function Pie3D({ slices, size = 150, depth = 9 }: { slices: { share: number; color: string; dark: string }[]; size?: number; depth?: number }) {
  let acc = 0;
  const stops = slices.map((s) => {
    const from = acc;
    acc += s.share * 360;
    return { ...s, from, to: acc };
  });
  const top = stops.map((s) => `${s.color} ${s.from}deg ${s.to}deg`).join(",");
  const side = stops.map((s) => `${s.dark} ${s.from}deg ${s.to}deg`).join(",");
  return (
    <div className="pie3d" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="pie3d-layer"
          style={{ transform: `translateZ(${i * 3}px)`, background: `conic-gradient(${i === depth - 1 ? top : side})` }}
        />
      ))}
    </div>
  );
}
