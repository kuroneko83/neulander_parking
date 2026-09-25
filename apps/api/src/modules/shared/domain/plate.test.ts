import { describe, expect, it } from "vitest";

import { maskPlate, normalizePlate } from "./plate";

describe("normalizePlate", () => {
  const validCases: { label: string; input: string; expected: string }[] = [
    { label: "Mercosul, já normalizada", input: "ABC1D23", expected: "ABC1D23" },
    { label: "Mercosul, minúscula", input: "abc1d23", expected: "ABC1D23" },
    { label: "Mercosul, com espaço", input: "ABC 1D23", expected: "ABC1D23" },
    { label: "Mercosul, com traço", input: "ABC-1D23", expected: "ABC1D23" },
    { label: "Mercosul, minúscula + espaços nas pontas", input: "  abc 1d23  ", expected: "ABC1D23" },
    { label: "antiga, já normalizada", input: "ABC1234", expected: "ABC1234" },
    { label: "antiga, minúscula", input: "abc1234", expected: "ABC1234" },
    { label: "antiga, com espaço", input: "ABC 1234", expected: "ABC1234" },
    { label: "antiga, com traço", input: "ABC-1234", expected: "ABC1234" },
  ];

  it.each(validCases)("normaliza $label ($input) para $expected", ({ input, expected }) => {
    expect(normalizePlate(input)).toBe(expected);
  });

  const invalidCases: { label: string; input: string }[] = [
    { label: "vazia", input: "" },
    { label: "curta demais", input: "ABC123" },
    { label: "longa demais", input: "ABC12345" },
    { label: "antiga com letra no lugar de dígito", input: "ABC123A" },
    { label: "Mercosul com dígito no lugar da letra do meio", input: "ABC12A3" },
    { label: "Mercosul com letra no lugar do último dígito", input: "ABC1D2A" },
    { label: "só números", input: "1234567" },
    { label: "caracteres impossíveis (símbolos)", input: "AB@1D23" },
    { label: "4 letras no início", input: "ABCD123" },
  ];

  it.each(invalidCases)("rejeita placa $label ($input)", ({ input }) => {
    expect(() => normalizePlate(input)).toThrow(/Placa inválida/);
  });

  it("rejects with the DomainError code INVALID_PLATE", () => {
    try {
      normalizePlate("not-a-plate");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INVALID_PLATE");
    }
  });
});

describe("maskPlate", () => {
  it("keeps only the first 3 characters visible, masking the rest", () => {
    expect(maskPlate("ABC1D23")).toBe("ABC****");
    expect(maskPlate("ABC1234")).toBe("ABC****");
  });

  it("normalizes case/spacing/dashes before masking, same as normalizePlate", () => {
    expect(maskPlate("abc-1d23")).toBe("ABC****");
    expect(maskPlate(" abc 1234 ")).toBe("ABC****");
  });

  it("never returns the full plate, even for a short/garbage input", () => {
    expect(maskPlate("AB")).toBe("**");
    expect(maskPlate("")).toBe("");
    expect(maskPlate("A")).toBe("*");
  });

  it("never throws, unlike normalizePlate, so it's always safe right before a log line", () => {
    expect(() => maskPlate("###invalid###")).not.toThrow();
    expect(maskPlate("###invalid###")).not.toBe("###invalid###");
  });
});
