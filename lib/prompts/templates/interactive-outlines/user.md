Generate an Ultra Mode course outline based on the following requirements.

---

## User Requirements

{{requirement}}

---

{{userProfile}}

## Course Language

**Required language**: {{language}}

---

## Reference Materials

### PDF Content Summary

{{pdfContent}}

### Available Images

{{availableImages}}

### Web Search Results

{{researchContext}}

{{teacherContext}}

---

## Distribution Target

- **70% interactive scenes** (widgets: simulation, diagram, code, game, visualization3d)
- **30% slide scenes** (introductions, summaries, transitions)
- When the user leaves all scene-type counts to AI (**auto / 0 = AI decides**), push **even harder** toward interactives: more distinct widget scenes, fewer long slide-only stretches, and rotate widget types across the lesson.
- For **quiz** scenes: prefer **fewer pages** with **more questions each** (often **6–12** per quiz for intensive practice / 考研), not many pages with a single question.

## Widget Type Constraints (MANDATORY)

| Widget Type | Constraint |
|------------|-----------|
| simulation | **Minimum 2 scenes** |
| game | **Minimum 1 scene** |
| diagram | **Maximum 1 scene** (unless the user clearly needs more process maps) |
| visualization3d | **At least 1 scene** when the topic involves 3D structure, orbits, molecules, anatomy, or solid geometry |

## CRITICAL: Required Fields for Interactive Scenes

Every interactive scene MUST include:
- `widgetType`: One of "simulation", "diagram", "code", "game", or "visualization3d"
- `widgetOutline`: Object with widget-specific configuration

Interactive scenes without these fields are INVALID.

## Widget Selection Guide

Choose widgets based on the content:

| Content Type | Recommended Widget |
|--------------|-------------------|
| Physics/Chemistry/Biology processes | simulation |
| Systems, processes, hierarchies | diagram |
| Programming, algorithms | code |
| Practice, challenge, application | game (action preferred) |

## Widget Design Principles (IMPORTANT)

### Simulation Widget
- Mobile-friendly: Controls MUST NOT overlap canvas
- Reset button MUST work correctly
- Touch-friendly controls (44px min)

### Diagram Widget
- First node VISIBLE on load (no blank screen)
- HIGH CONTRAST colors
- Add ICONS to nodes
- Color-code node types

### Game Widget (CRITICAL - NO BORING QUIZZES!)
- **PREFER action/puzzle games over quizzes**
- Player MUST control something (not just click answers)
- If using simulation, make it INTERACTIVE gameplay
- Example GOOD game: "Control thrust to land safely"
- Example BAD game: "Click the correct answer"
- `gameType` should be "action", "puzzle", or "strategy", NOT just "quiz"

### Example: Good vs Bad Game Outline

❌ **BAD (boring quiz):**
```json
{
  "widgetType": "game",
  "widgetOutline": {
    "gameType": "quiz",
    "questionCount": 5
  }
}
```

✅ **GOOD (interactive game):**
```json
{
  "widgetType": "game",
  "widgetOutline": {
    "gameType": "action",
    "challenge": "控制推力使飞船安全着陆",
    "playerControls": ["thrust_slider"]
  }
}
```

---

{{mediaGenerationPolicy}}

Please output JSON array directly without additional explanatory text.
