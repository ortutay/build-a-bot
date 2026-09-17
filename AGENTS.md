# Builder conventions

- Only read `process.env` in `src/constants.ts`; export a named constant for other modules to use.

# Helpful hepers

- When possible, use `getOrNull<type>(obj, 'field')` to get fields in objects instead of long inline ternaries and checks.

# Imports

Place imports in order of these categories.

- nodejs packages
- external packages
- @fetchfox/builder
- local files

Within each category, place them alphabetically.

Do not put new lines between the categories.

# Style

- Always use curly braces for `if` statements; avoid inline `if (...) ...;`.
- Prefer post-increment (`i++`) for incrementing loop counters.
- Prefer `val` to `value`
- Prefer `resp` to `response`
- Prefer `init()` to `initialize()`.
- Prefer `tx` to `transaction`.
- Prefer short names when possible, for example `fingerprint` over `buildFingerprint`.
- Name caught errors `e`, including Promise `.catch()` parameters.
- Place static methods immediately after the constructor, before all instance methods.
- Place an object's `id` field before all other fields.

# Tool schemas and types

- Treat Zod schemas as the source of truth for tool-specific input and output types. Derive types with `z.input<typeof schema>` for inputs before parsing and `z.infer<typeof schema>` (or `z.output`) for parsed inputs and outputs. Do not duplicate those contracts in handwritten types.
- Preserve shared domain types, such as `DocumentSummary`, independently of tool schemas. When a tool schema represents a domain type, check compatibility with `satisfies z.ZodType<DomainType>` without widening away the concrete schema type.
- Reuse the same schema in tool registration and executor typing. Executors that accept unparsed inputs must account for schema defaults and transformations; use the parsed output type after parsing.
- Let `createTool` infer inline callback types when sufficient. Construction options, internal runtime state and external MCP contracts do not need new Zod schemas solely for type derivation.
