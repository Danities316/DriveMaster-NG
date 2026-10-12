export interface CurriculumTopic {
  id: string;
  name: string;
  active: boolean;
}

export interface SchoolCurriculum {
  topics: CurriculumTopic[];
  reason: string;
}

export const DEFAULT_CURRICULUM_TOPICS: CurriculumTopic[] = [
  { id: "car-controls", name: "Know your car and basic controls", active: true },
  { id: "simulator", name: "Simulator and basic vehicle control", active: true },
  { id: "road-rules", name: "Road signs, rules and safe driving", active: true },
  { id: "traffic-control", name: "Traffic lights, wardens and hand signals", active: true },
  { id: "right-of-way", name: "Junctions, roundabouts and right of way", active: true },
  { id: "overtaking", name: "Overtaking and meeting other vehicles", active: true },
  { id: "steering-gears", name: "Steering, gears and road positioning", active: true },
  { id: "move-stop", name: "Moving off, stopping and observation", active: true },
  { id: "road-practice", name: "Real-road driving practice", active: true },
  { id: "reversing", name: "Straight-line and corner reversing", active: true },
  { id: "parking", name: "Parking and manoeuvres", active: true },
  { id: "revision", name: "Revision and internal test", active: true },
  { id: "frsc-theory", name: "FRSC theory and test preparation", active: true },
  { id: "test-reverse", name: "Test preparation and reverse practice", active: true },
  { id: "confidence", name: "Road practice and confidence building", active: true }
];

export const DEFAULT_SCHOOL_CURRICULUM: SchoolCurriculum = {
  topics: DEFAULT_CURRICULUM_TOPICS,
  reason: "DriveMaster starter lesson topics"
};
