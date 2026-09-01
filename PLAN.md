# New Plan

- This is a new plan that I'm writing for the next phase of delvelopment on the codebase of this project.
- As AGENT please read this file and then rewrite it in order to make an actionable plan to build this idea.
- Make a list of steps to follow for each phase and then outline a to-do list to complete each task.

## Building a multi-view port

- Let's create a new html file to house this view... let's call it 'multi-view.html'.
- There should be another option/(button) alongside 'batch delete'... it should be called "multi-view" button and should create this new multi-view.html when clicked.
- The html page should always display the current.svg view and will be able to display a selection of other options and history that are currently selected via the multi-select boxes when the page is created.
- The html page should also have 'new-current.svg', that starts as a copy of current.svg when the multiview.html opens
- The current.svg and all selected options & history will each have a label that is it's filename and also will have a button to promote it to the new-current.svg.
- When the page is closed via a button the 'new-current.svg' will overwrite the projects current.svg in index.html; a modal should come up to verify this overwrite similiarly to deleting in index.html.
