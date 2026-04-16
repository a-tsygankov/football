export function formatClubChangeField(field: string): string {
  switch (field) {
    case 'overallRating':
      return 'Overall'
    case 'attackRating':
      return 'Attack'
    case 'midfieldRating':
      return 'Midfield'
    case 'defenseRating':
      return 'Defense'
    case 'starRating':
      return 'Stars'
    default:
      return field
  }
}

export function formatPlayerChangeField(field: string): string {
  switch (field) {
    case 'pace':
      return 'PAC'
    case 'shooting':
      return 'SHO'
    case 'passing':
      return 'PAS'
    case 'dribbling':
      return 'DRI'
    case 'defending':
      return 'DEF'
    case 'physical':
      return 'PHY'
    case 'overall':
      return 'OVR'
    default:
      return field
  }
}
