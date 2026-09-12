# @outpost/ui

The shared UI kit of Outpost: Vue components, the Tailwind CSS v4 theme and the `cn()` class helper.
The web app and every plugin use this package instead of a third-party component library, so the
look and the component API stay under the project's control.

```ts
import { Button, Card, CardContent } from '@outpost/ui';
```

```css
/* App stylesheet */
@import 'tailwindcss';
@import '@outpost/ui/styles.css';
```

Icons come from [Lucide](https://lucide.dev) (`@lucide/vue`).

## Where the components come from

The components in `src/components/` are generated with the
[shadcn-vue](https://www.shadcn-vue.com) CLI (MIT License) on top of
[Reka UI](https://reka-ui.com) (MIT License), with these settings: style `reka-nova`, base color
`neutral`, icon library `lucide`. They are kept close to the generated code so upstream fixes are
easy to apply.

To add a component:

1. Generate it in a throwaway Vite project:
   `npx shadcn-vue@latest init -t vite -n scratch --base reka --icon-library lucide -b neutral --defaults`,
   then `npx shadcn-vue@latest add <component>` inside `scratch/`.
2. Copy `scratch/src/components/ui/<component>/` to `src/components/<component>/` and replace the
   `@/lib/utils` and `@/components/ui/<name>` imports with relative paths.
3. Export it from `src/index.ts`.
