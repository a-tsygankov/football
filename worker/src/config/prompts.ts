/**
 * Gemini vision prompt for extracting match results from TV screenshots.
 *
 * The model receives a photo of a TV screen showing EA Sports FC post-match
 * results and must return a JSON object with team names, score, and
 * confidence. When team context is provided (names + aliases from the
 * active game), the model also confirms whether the on-screen teams match.
 *
 * Prompt is built dynamically because the team-matching section is only
 * relevant when the active game has FC teams assigned.
 */

export function buildScoreAnalysisPrompt(context: {
  homeTeam?: { name: string; aliases: string[] } | null
  awayTeam?: { name: string; aliases: string[] } | null
}): string {
  const base = `You are analysing a photo of a TV screen showing EA Sports FC 26 post-match results.

SCORE LOCATION:
The final score is displayed in a small horizontal bar at the top of the screen (usually top-right, sometimes top-center). The bar format is:
  [Match Time] [Home Team Name] [Home Badge] [Home Goals] - [Away Goals] [Away Badge] [Away Team Name]

The home team is always on the LEFT side of the score and the away team on the RIGHT side.

The rest of the screen shows a post-match menu (items like "NEXT MATCH", "QUIT", "MATCH FACTS", "PERFORMANCE", "HIGHLIGHTER") and a replay/scene from the match -- ignore all of that. Focus ONLY on the score bar.

Extract the final score and team names from the score bar. Return ONLY a JSON object:

{
  "homeTeam": "<team name from the LEFT side of the score bar>",
  "awayTeam": "<team name from the RIGHT side of the score bar>",
  "homeScore": <integer goals for home team>,
  "awayScore": <integer goals for away team>,
  "confident": true${context.homeTeam || context.awayTeam ? ',\n  "teamsMatched": true' : ''}
}`

  const teamLines: string[] = []
  if (context.homeTeam) {
    const aliases = context.homeTeam.aliases.length > 0
      ? ` (also known as: ${context.homeTeam.aliases.map((a) => `"${a}"`).join(', ')})`
      : ''
    teamLines.push(`- Home (left): "${context.homeTeam.name}"${aliases}`)
  }
  if (context.awayTeam) {
    const aliases = context.awayTeam.aliases.length > 0
      ? ` (also known as: ${context.awayTeam.aliases.map((a) => `"${a}"`).join(', ')})`
      : ''
    teamLines.push(`- Away (right): "${context.awayTeam.name}"${aliases}`)
  }

  const teamSection = teamLines.length > 0
    ? `\n\nTEAM MATCHING:
The active game expects these teams:
${teamLines.join('\n')}

Compare the team names visible in the score bar against these expected names and their aliases. Set "teamsMatched" to true ONLY if BOTH teams on screen match the expected teams (by exact name or any listed alias, case-insensitive). Set "teamsMatched" to false if either team does not match.

Ignore any gamer nicknames, gamertags, or PSN IDs visible elsewhere on screen -- they are NOT team names.`
    : ''

  const rules = `\n\nRULES:
- Read team names exactly as shown in the score bar.
- The score is the two numbers separated by a dash (e.g. "6 - 2" means home scored 6, away scored 2).
- Set "confident" to false if the score bar is not visible, unreadable, or the image is not a post-match screen.
- If you cannot determine the score, set homeScore and awayScore to null.
- Return ONLY valid JSON, no markdown fences, no explanation.`

  return base + teamSection + rules
}

/**
 * Ordered model fallback chain for score analysis. The worker tries each
 * model in sequence until one succeeds. Cheapest/fastest first.
 *
 * Gemini REST endpoint pattern:
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */
export const SCORE_ANALYSIS_MODELS = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash',
  'gemini-2.5-pro-preview-05-06',
] as const

export type ScoreAnalysisModel = (typeof SCORE_ANALYSIS_MODELS)[number]

/** Simple ping prompt to verify the API key + model access. */
export const AI_HANDSHAKE_PROMPT = 'Respond with exactly: {"status":"ok"}' as const
