# AUTHORING.md — making an SVG in svg-creator

## Use a componentized approach

- Authoring svgs in Svg-creator is a components first approach.
- Components aids in the collaborative nature of making an svg.
- Parts of an SVG can be reused more easily within another svg.

### When modifying an existing svg

- Keep the existing code intact. There may be no reason to actually componentize it. 
- If adding a new feature to existing svg, add it as a component; and don't worry about the rest of the legacy svg paths.
- If it becomes clear that the existing svg code must be componentized, do so... see converting an svg below.

### Components make collaborating better

- Both the USER and AGENT have a better way to conversationally discuss the work that needs to get done. 
- "Modify the mouth" is now an ask that is targetable and easily actionable rather than an ambiguous ask lost in a jumble of svg paths.

## Use relative positioning

- This way a 'component' can easily be moved without redoing a bunch of math.
  -This saves on AGENT token usage, being both cost effective and quicker.

## Converting an svg

- Many svgs are single path objects.
- Single path objects aren't necessarily very easy for an AGENT or USER to consider iteratively collaborating upon.

### Inferring components

- First and foremost, ask the USER to help.
- Think about what the image is and logically determine what components it might contain.
- The USER and AGENT are collaborating in this endeavor... but the USER has the final artistic license.
- Finally, after arriving at a final list of components
