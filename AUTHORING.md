# AUTHORING.md — making an SVG in svg-creator

## Use a componentized approach

- Authoring svgs in Svg-creator is a components first approach.
- Components aids in the collaborative nature of making an svg.
- Parts of an SVG can be reused more easily within another svg.
- Use relative positioning.

### Components make collaborating better

- Both the USER and AGENT have a better way to conversationally discuss the work that needs to get done. 
- "Modify the mouth" is now an ask that is targetable and easily actionable rather than an ambiguous ask lost in a jumble of svg paths.

### When making an svg from 'scratch'

- Take a components first approach.
- Use relative positioning.
- First, AGENTS should think about what is being asked, and how to go about it.
- If a 'pelican is riding a bicycle' then we have two base components... a bike and a pelican.
  - Each of those components have sub-components and so on.
- A highly componentized svg will be hierarchical and nested... this is fine.
  - The svg code should reflect this hierarchy.
- Each component should have a label as <!comment>.

### When modifying an existing svg

- Keep the existing code intact. There may be no reason to actually componentize it. 
- If adding a new feature to existing svg, add it as a component; and don't worry about the rest of the legacy svg paths.
- If it becomes clear that the existing svg code must be componentized, do so... see converting an svg below.

## Use relative positioning

- This way a 'component' can easily be moved without redoing a bunch of math.
  -This saves on AGENT token usage, being both cost effective and quicker.
- This also makes it easier for a human to slightly move something for alignment purposes... the USER has good eyesight and should use it.

## Converting an svg

- Many svgs are single path objects.
- Single path objects aren't necessarily very easy for an AGENT or USER to consider iteratively collaborating upon.

### Inferring components

- First and foremost, ask the USER to help.
- Think about what the image is and logically determine what components it might contain.
- The USER and AGENT are collaborating in this conversion endeavor... but the USER has the final artistic license.
- Finally, after arriving at a final list of components... do the work.

### Converting the file

- This section is going to be filled out by an AGENT, because I'm not to knowledgeable.
