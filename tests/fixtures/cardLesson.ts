// A card lesson that uses every card type, for the preview and audit tests and the local player check.
import type { LessonWriterOutput } from "@/lib/pipeline/schemas";

export const allCardTypesLesson: LessonWriterOutput = {
  activities: [
    { id: "c1", type: "predict", part: "Your first formula", cites: [1], prompt: "What does =2+3*4 show?", options: ["20", "14", "9"], answer: 1, reveal: "Excel multiplies before it adds, so 3*4 is 12, plus 2 is 14 [1]." },
    {
      id: "c2",
      type: "reading",
      part: "Your first formula",
      cites: [1, 2],
      title: "Let Excel do the math",
      pages: [
        "A cell is a formula only if it starts with an **equal sign** [1]. Without it, Excel shows what you typed as text.",
        "Point at cells instead of typing numbers: `=A1+B1` keeps working when A1 or B1 changes, and =B2*C2 multiplies two cells [2].",
      ],
    },
    { id: "c3", type: "video", part: "Your first formula", cites: [], video: 1, watchFor: ["Every formula starts with =", "The * key for multiply"] },
    {
      id: "c4",
      type: "decide",
      part: "Your first formula",
      cites: [2],
      scenario: "Your shopping list total is typed by hand. A price changes.",
      options: [
        { text: "Retype the total", outcome: "It works until the next change, then goes stale again [2].", best: false },
        { text: "Replace it with =SUM(D2:D3)", outcome: "The total updates on its own whenever a price changes [2].", best: true },
      ],
    },
    { id: "c5", type: "reading", part: "Functions", cites: [1], title: "Functions", pages: ["A function is a named formula, like `=SUM(A1:A4)` [1].", "AVERAGE finds a typical value; COUNT counts numbers [1]."] },
    { id: "c6", type: "match", part: "Functions", cites: [1], prompt: "Match the question to the function", pairs: [{ left: "How much altogether?", right: "SUM" }, { left: "What's typical?", right: "AVERAGE" }, { left: "How many numbers?", right: "COUNT" }] },
    { id: "c7", type: "order", part: "Functions", cites: [1], prompt: "Put the AutoSum steps in order", items: ["Select the cell below your numbers", "Select AutoSum", "Check the range", "Press Enter"], explain: "Select, AutoSum, check, Enter [1]." },
    { id: "c8", type: "mythFact", part: "Functions", cites: [1], items: [{ statement: "COUNT adds up numbers.", fact: false, why: "COUNT counts how many cells hold numbers; SUM adds them [1]." }, { statement: "=b3 works like =B3.", fact: true, why: "Capitals are optional [1]." }] },
    { id: "c9", type: "spotError", part: "Functions", cites: [1], prompt: "Find the mistake in these steps", segments: ["Type = in the cell", "Type 8x2", "Press Enter"], errorIndex: 1, correction: "Type 8*2.", why: "Excel multiplies with *, not x [1]." },
    { id: "c10", type: "practiceStep", part: "Functions", cites: [], instructions: "Type 10, 20, 30 and 40 in A1:A4, then `=SUM(A1:A4)` in A5.", expectedOutcome: "A5 shows 100.", minutes: 3 },
    { id: "c11", type: "explainBack", part: "Functions", cites: [2], prompt: "Why is =B2*C2 better than typing 12?", keyPoints: ["It recalculates", "A typed number goes stale", "Type inputs once"], modelAnswer: "The formula updates when B2 or C2 changes; a typed 12 goes stale [2]." },
  ],
  keyTerms: [
    { term: "Formula", definition: "An instruction that starts with =." },
    { term: "Function", definition: "A named, ready-made formula." },
    { term: "Range", definition: "A block of cells, like A1:A4." },
  ],
};
