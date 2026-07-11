interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

export function parseUnsignedDecimal(value: string): DecimalValue {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

export function formatDecimal(value: DecimalValue): string {
  const negative = value.coefficient < 0n;
  const absolute = negative ? -value.coefficient : value.coefficient;
  if (value.scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(value.scale + 1, "0");
  const whole = padded.slice(0, -value.scale);
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function sumDecimalStrings(values: string[]): string {
  if (values.length === 0) return "0";
  const parsed = values.map(parseUnsignedDecimal);
  const scale = Math.max(...parsed.map((item) => item.scale));
  const coefficient = parsed.reduce(
    (total, item) => total + item.coefficient * powerOfTen(scale - item.scale),
    0n,
  );
  return formatDecimal({ coefficient, scale });
}

export function sumTokenRates(
  values: Array<{ tokens: number; ratePerMillion: string }>,
): string {
  if (values.length === 0) return "0";
  const rates = values.map((item) => ({ ...item, rate: parseUnsignedDecimal(item.ratePerMillion) }));
  const rateScale = Math.max(...rates.map((item) => item.rate.scale));
  const coefficient = rates.reduce(
    (total, item) => total +
      BigInt(item.tokens) * item.rate.coefficient * powerOfTen(rateScale - item.rate.scale),
    0n,
  );
  return formatDecimal({ coefficient, scale: rateScale + 6 });
}
