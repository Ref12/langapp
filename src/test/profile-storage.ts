import { db } from '../core/database'
import { initializeProfiles, profileRegistry, resetProfilesForTests, resetSelectedProfile } from '../core/profiles/store'

export async function resetProfileStorage() {
  await profileRegistry.delete()
  await db.delete()
  resetSelectedProfile()
  resetProfilesForTests()
  await initializeProfiles()
  await db.open()
}
