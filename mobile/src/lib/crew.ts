/** The two kinds of vehicle crew the SACCO office manages, and the words used for each. */
export type CrewRole = 'conductor' | 'driver';

export const CREW: Record<CrewRole, { path: 'conductors' | 'drivers'; one: string; many: string; icon: 'person-outline' | 'car-outline' }> = {
  conductor: { path: 'conductors', one: 'conductor', many: 'Conductors', icon: 'person-outline' },
  driver: { path: 'drivers', one: 'driver', many: 'Drivers', icon: 'car-outline' },
};

export const crewRole = (value: string | undefined): CrewRole => (value === 'driver' ? 'driver' : 'conductor');
