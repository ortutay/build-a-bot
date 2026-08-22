# Builder conventions

- Name caught errors `e`, including Promise `.catch()` parameters.
- Name HTTP responses `resp`.
- Only read `process.env` in `src/constants.ts`; export a named constant for other modules to use.

# Helpful hepers

- When possible, use `getOrNull<type>(obj, 'field')` to get fields in objects instead of long inline ternaries and checks.
