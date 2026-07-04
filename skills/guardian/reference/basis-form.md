# Guardian — basis-form (the standard)

basis-form is Guardian's definition of quality. It governs **structure, code, scripts, and instructions** alike: describe the decision space by its **basis** (the axes), never by its **cases** (the points). A finite basis generates every case, including ones never written; a case-list only covers what was enumerated.

The four AI Repo properties are its consequences: compressible ← orthogonal + irreducible; contractual ← spanning captured in types/schemas; verifiable ← spanning + enforcement; safe ← off-axis points quarantined. The 8 dimensions in `methodology.md` are its projections.

## The four tests

- **Irreducible** — remove it and the span shrinks; no combination of the others recovers it. Violation: duplication / more than one source of truth. Fix: derive the rest from one.
- **Orthogonal** — statements/modules share no content; changing one doesn't change what the other covers. Violation: a concern spread across places (change amplification). Fix: one owner; enforce with an import/dependency boundary.
- **Spanning** — every case in the space has a defined decision. Violation: partial function, unhandled case, missing validation. Fix: total functions, exhaustive match, schema at the edge.
- **Decodable** — the reader (human or model) expands the axis into cases from their own priors. Violation: clever / over-compressed. Fix: idiomatic to the codebase's conventions.

## Two directions of failure (both violate basis-form)

- **Case-enumeration** (under-abstraction): a point-list where an axis exists — a `switch`/`if` per case, copy-paste, hardcoded variants. Migrate case→basis **only when the axis is already visible** (≈3 concrete points) and the migration reduces blast radius or ambiguity.
- **Empty axis** (over-abstraction): a basis vector added before its span exists — a generic wrapper/framework/config with no concrete consumer. It spans a space with no points. Collapse it back to cases until the axis reappears.

Never create an axis speculatively; never leave a visible axis as cases. This guardrail is intrinsic to basis-form, not borrowed from any repo.

## Syndrome → enforcement (climb the ladder)

The essence — are these the domain's true axes? — is judgment; propose it, let the human confirm at the edges. The syndromes are mechanizable: each maps to a check in `enforcement.md`. Promote them into the repo's own enforcement.

Tag basis-form findings by projection: case-enumeration → `pattern-hygiene`, empty-axis → `compressibility`, non-orthogonal → `boundary-integrity`, non-spanning → `verification-loop`.

## Surfaces (basis-form applies uniformly)

- **structure** — folders are axes, files are points; "where does X go?" and "what do I change for Y?" have one obvious answer.
- **code / scripts** — functions, parameters, and types over branches, duplication, and partial cases.
- **instructions** — the repo's instruction surfaces (per `bindings.md`) must themselves be written in basis-form (axes, not case-lists). Where a basis-form rule belongs in a durable surface and is missing, **propagate it there** (write it), then promote its syndrome to enforcement where one exists.

## How Guardian applies it

basis-form is not a mode you run; it is how every mode judges and acts. `plan` derives the axes before writing points. `review`/`audit` detect drift in both directions. `improve` migrates case→basis or collapses an empty axis, then promotes the syndrome. `docs` keeps instruction surfaces in basis-form and propagates missing rules. Guardian **acts** — editing, restructuring, and propagating — gated by risk: contained changes directly, structural or high-risk changes proposed first.
