/**
 * Gemini vision prompt for extracting match results from TV screenshots.
 *
 * The model receives a photo of the post-match stats screen and must return
 * a JSON object with the two FC team names and the final score. Gamer
 * nicknames visible on screen are explicitly excluded — they belong to the
 * room model, not the vision output.
 */
export const SCORE_ANALYSIS_PROMPT = `You are analysing a photograph of a TV screen showing the post-match statistics of an EA Sports FC football video game.

Extract the following information and return it as a JSON object — nothing else, no markdown fences:

{
  "homeTeam": "<full name of the home team>",
  "awayTeam": "<full name of the away team>",
  "homeScore": <integer goals scored by home team>,
  "awayScore": <integer goals scored by away team>
}

Rules:
- Use the official team names exactly as shown on screen.
- Ignore any gamer nicknames / gamertags / PSN IDs visible on screen — they are NOT relevant.
- If you cannot confidently determine the score or a team name, set the value to null.
- Return ONLY the JSON object, no explanation.`

export const SCORE_ANALYSIS_MODEL = 'gemini-2.0-flash' as const
