# New Plans
- This is a new plan that I'm writing for the next phase/s of delvelopment on the codebase of this project.
- As AGENT please read this file and then rewrite it in order to make an actionable plan to build this idea.
- Make a list of steps to follow for each phase and then outline a to-do list to complete each task.
## Building a 'file system'
- Let's create a new html file for this view/feature set... let's call it 'file-tree.html'.
- The file-tree.html page should be similar to index.html in that it contains both the left 'file-tree'-like System (projects, options, and history), and the canvas view of current.svg.
- the file tree thing should contain a list of all 'files' and a "decompressed" SVG format:
- MarkUp example:'''
(svg content = ideally inline documentation from the SVG used as labels)
/fish
//current
///group
////svg content
////group
/////svg content
/////svg content
////group
/////svg content
/////svg content
/////svg content
////svg content
/fish-variant
'''
   - notice '/fish-variant' it is another SVG 'file'/project name/root folder... it is not expanded.
   - only one file will be expandable at one time.
- the left file tree should be scrollable so it can accommodate large 'file' sets or large svg files or combo there of.
- "(svg content = ideally inline documentation in SVG as labels)" as above is implying that i would like to parse this from the SVG itself and if the file is documented correctly it will show that message in the file tree.
- If it isn't grouped or fully grouped it will look more like this:'''
(svg content = in this context might merely say 'square', 'arc', 'line', 'path', etc.)
/fish
/fish variant
//current
///svg content
///svg content
///svg content
///svg content
///svg content
///svg content
///svg content
(This is a completely flat file)
'''
   - 'svg content' = in this context might merely say 'square', 'arc', 'line', 'path', etc., or might be commented
- the currently expanded view should be as current.svg on canvas.
- the root folders/projects ( /fish or /fish-variant ) should be expandable/shrinkable. shrunk by default.
- /current should be expandable/shrinkable too. expanded by default... so when you click and expand the /root the whole svg file is displayed 'decompressed'... or as much as the case might dictate.
- /group behave in this same fashion. they are shrunk by default.
- and so on...
- **help me write a good plan for you to implement.**
