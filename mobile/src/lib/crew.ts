/** The field staff the SACCO office manages (vehicle crew, and stage marshals who have no vehicle), and the words used for each. */
export type CrewRole = 'conductor' | 'driver' | 'marshal';

export const CREW: Record<
  CrewRole,
  { path: 'conductors' | 'drivers' | 'marshals'; one: string; many: string; icon: 'person-outline' | 'car-outline' | 'flag-outline'; onVehicle: boolean }
> = {
  conductor: { path: 'conductors', one: 'conductor', many: 'Conductors', icon: 'person-outline', onVehicle: true },
  driver: { path: 'drivers', one: 'driver', many: 'Drivers', icon: 'car-outline', onVehicle: true },
  marshal: { path: 'marshals', one: 'stage marshal', many: 'Stage marshals', icon: 'flag-outline', onVehicle: false },
};

export const crewRole = (value: string | undefined): CrewRole => (value === 'driver' || value === 'marshal' ? value : 'conductor');
