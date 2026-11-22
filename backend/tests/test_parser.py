"""Comprehensive unit tests for backend.parser (Phase 1.2 Data Integrity Remediation)."""
import unittest
import json
from backend.parser import parse_vtop_data


class TestParser(unittest.TestCase):
    def test_schema_1_5_0_wrapped_export(self):
        payload = {
            "schemaVersion": "1.5.0",
            "source": {
                "system": "VTOP",
                "campus": "VIT Bhopal University",
                "verifiedOrigin": "https://vtop.vitbhopal.ac.in",
                "extensionVersion": "1.1.0"
            },
            "metrics": {"totalCourses": 1, "totalOfferings": 1},
            "courses": [
                {
                    "courseCode": "CSE3001",
                    "courseName": "Software Engineering",
                    "credits": 4,
                    "categories": ["Program Core"],
                    "options": [
                        {
                            "courseCode": "CSE3001",
                            "offeringId": '["CSE3001","THEORY",["A11","A14"],"DR. ANIL KUMAR","AB01-304"]',
                            "sourceOfferingId": "1001",
                            "scopedSourceId": '["CSE3001","THEORY","1001"]',
                            "componentType": "Theory",
                            "rawSlot": "A11+A14",
                            "slots": ["A11", "A14"],
                            "slotVerificationStatus": "CONFIRMED_THEORY",
                            "facultyName": "Dr. Anil Kumar",
                            "venue": "AB01-304",
                            "building": "AB01",
                            "room": "304",
                            "availableSeats": 20,
                            "totalSeats": 60,
                            "classStatus": "Open"
                        }
                    ]
                }
            ]
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertEqual(len(res.errors), 0)
        self.assertEqual(len(res.subjects), 1)
        subj = res.subjects[0]
        self.assertEqual(subj.courseCode, "CSE3001")
        self.assertEqual(subj.courseName, "Software Engineering")
        self.assertEqual(subj.category, "Program Core")
        self.assertEqual(subj.credits, 4)
        self.assertEqual(len(subj.options), 1)
        opt = subj.options[0]
        self.assertEqual(opt.facultyName, "Dr. Anil Kumar")
        self.assertEqual(opt.slot, "A11+A14")
        self.assertEqual(opt.rawSlot, "A11+A14")
        self.assertEqual(opt.slots, ["A11", "A14"])
        self.assertEqual(opt.venue, "AB01-304")
        self.assertEqual(opt.building, "AB01")
        self.assertEqual(opt.seatsAvailable, 20)
        self.assertEqual(opt.seatState, "AVAILABLE")
        self.assertEqual(opt.totalSeats, 60)
        self.assertEqual(opt.courseType, "Theory")

    def test_legacy_array_format(self):
        payload = [
            {
                "courseCode": "MAT2001",
                "courseName": "Differential Equations",
                "credits": 3,
                "category": "UC",
                "options": [
                    {
                        "facultyName": "Dr. Ramanujan",
                        "slot": "C11+C14",
                        "venue": "AB02-101",
                        "seatsAvailable": 35,
                        "totalSeats": 70,
                        "courseType": "TH"
                    }
                ]
            }
        ]
        res = parse_vtop_data(json.dumps(payload))
        self.assertEqual(len(res.errors), 0)
        self.assertEqual(len(res.subjects), 1)
        subj = res.subjects[0]
        self.assertEqual(subj.courseCode, "MAT2001")
        self.assertEqual(len(subj.options), 1)
        self.assertEqual(subj.options[0].seatsAvailable, 35)
        self.assertEqual(subj.options[0].seatState, "AVAILABLE")

    def test_unsupported_schema_version_rejected(self):
        payload = {
            "schemaVersion": "9.9.9",
            "courses": []
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertTrue(len(res.errors) > 0)
        self.assertTrue(any("Unsupported schemaVersion" in e for e in res.errors))
        self.assertEqual(len(res.subjects), 0)

    def test_wrapped_export_requires_schema_version(self):
        res = parse_vtop_data(json.dumps({"courses": []}))
        self.assertTrue(any("missing required schemaVersion" in e for e in res.errors))

    def test_empty_input_and_empty_courses(self):
        res_empty = parse_vtop_data("")
        self.assertTrue(len(res_empty.errors) > 0)

        res_no_courses = parse_vtop_data(json.dumps({"schemaVersion": "1.5.0", "courses": []}))
        self.assertEqual(len(res_no_courses.errors), 0)
        self.assertEqual(len(res_no_courses.subjects), 0)

    def test_distinguish_seat_states(self):
        # 1 positive (AVAILABLE), 1 zero (FULL), 1 null (UNKNOWN)
        payload = {
            "schemaVersion": "1.5.0",
            "courses": [
                {
                    "courseCode": "CSE2001",
                    "courseName": "Data Structures",
                    "credits": 4,
                    "options": [
                        {
                            "facultyName": "Prof. Available",
                            "slot": "A11",
                            "venue": "AB01-101",
                            "availableSeats": 10
                        },
                        {
                            "facultyName": "Prof. Full",
                            "slot": "B11",
                            "venue": "AB01-102",
                            "availableSeats": 0
                        },
                        {
                            "facultyName": "Prof. Unknown",
                            "slot": "C11",
                            "venue": "AB01-103",
                            "availableSeats": None
                        }
                    ]
                }
            ]
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertEqual(len(res.subjects), 1)
        opts = res.subjects[0].options
        self.assertEqual(len(opts), 3)

        self.assertEqual(opts[0].seatState, "AVAILABLE")
        self.assertEqual(opts[0].seatsAvailable, 10)

        self.assertEqual(opts[1].seatState, "FULL")
        self.assertEqual(opts[1].seatsAvailable, 0)

        self.assertEqual(opts[2].seatState, "UNKNOWN")
        self.assertIsNone(opts[2].availableSeats)

    def test_missing_required_fields_reporting(self):
        # Missing courseCode, missing facultyName, missing slot
        payload = {
            "schemaVersion": "1.5.0",
            "courses": [
                {
                    "courseName": "Nameless Course Without Code",
                    "options": []
                },
                {
                    "courseCode": "PHY1001",
                    "courseName": "Physics",
                    "options": [
                        {
                            "slot": "D11",
                            "venue": "AB01-101"
                            # Missing facultyName
                        },
                        {
                            "facultyName": "Dr. Slotless",
                            "venue": "AB01-102"
                            # Missing slot
                        }
                    ]
                }
            ]
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertTrue(len(res.rejectedRecords) > 0)
        self.assertTrue(any("missing required courseCode" in r["reason"] for r in res.rejectedRecords))
        # Incomplete options remain visible with field-level missing metadata.
        phy = next(s for s in res.subjects if s.courseCode == "PHY1001")
        self.assertEqual(len(phy.options), 2)
        self.assertIn("facultyName", phy.options[0].missingFields)
        self.assertEqual(phy.options[1].slotVerificationStatus, "MISSING_OR_INVALID")
        self.assertIn("slots", phy.options[1].missingFields)

    def test_slot_verification_preservation(self):
        payload = {
            "schemaVersion": "1.5.0",
            "courses": [
                {
                    "courseCode": "HUM1001",
                    "courseName": "Ethics",
                    "options": [
                        {
                            "facultyName": "Dr. GoodSlot",
                            "slot": "A11+A14",
                            "venue": "AB01-201",
                            "availableSeats": 5
                        },
                        {
                            "facultyName": "Dr. BadSlot",
                            "slot": "XYZ99+A11",
                            "venue": "AB01-202",
                            "availableSeats": 5
                        }
                    ]
                }
            ]
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertEqual(len(res.subjects), 1)
        opts = res.subjects[0].options
        self.assertEqual(opts[0].slotVerificationStatus, "CONFIRMED_THEORY")
        self.assertEqual(opts[1].slotVerificationStatus, "CONTAINS_UNVERIFIED")

    def test_wrapped_v150_preserves_offerings_matches_and_seat_states(self):
        payload = {
            "schemaVersion": "1.5.0", "source": "FFCS_OS_VTOP_EXTENSION",
            "courses": [
                {"courseCode": "CSE1001", "courseTitle": "Course", "courseStructure": "L-T-P", "options": [
                    {"facultyName": "Faculty A", "slots": ["A11", "A12"], "rawSlot": "A11+A11+A12",
                     "componentType": "Theory", "venue": "AB01-301", "availableSeats": 0},
                    {"facultyName": "Faculty B", "slot": "B11", "componentType": "Theory",
                     "venue": "AB02-201", "availableSeats": None},
                ]},
                {"courseCode": "CSE1001", "options": [
                    {"facultyName": "Faculty C", "slot": "C11", "componentType": "Lab",
                     "venue": "LC-001", "seatsAvailable": 5}
                ]},
            ],
            "possibleMatches": [{"courseCode": "CSE1001"}],
            "extractionReport": {"totalRowsScanned": 3},
        }
        res = parse_vtop_data(json.dumps(payload))
        self.assertEqual(res.errors, [])
        self.assertEqual(len(res.subjects), 1)
        self.assertEqual(len(res.subjects[0].options), 3)
        self.assertEqual(res.subjects[0].courseStructure, "L-T-P")
        a, b, c = res.subjects[0].options
        self.assertEqual((a.availableSeats, a.seatState, a.slots, a.rawSlot), (0, "FULL", ["A11", "A12"], "A11+A11+A12"))
        self.assertTrue(any("DUPLICATE_SLOT_TOKEN" in w for w in a.warnings))
        self.assertEqual((b.availableSeats, b.seatState), (None, "UNKNOWN"))
        self.assertEqual(c.availableSeats, 5)
        self.assertEqual(res.possibleMatches, payload["possibleMatches"])
        self.assertEqual(res.extractionMetadata["extractionReport"]["totalRowsScanned"], 3)

    def test_missing_component_and_malformed_slot_are_retained_as_incomplete(self):
        payload = {"schemaVersion": "1.5.0", "courses": [{"courseCode": "CSE1002", "options": [
            {"facultyName": None, "rawSlot": "A11+???", "availableSeats": None}
        ]}]}
        res = parse_vtop_data(json.dumps(payload))
        option = res.subjects[0].options[0]
        self.assertEqual(option.componentType, "UNKNOWN")
        self.assertEqual(option.slotVerificationStatus, "MISSING_OR_INVALID")
        self.assertIn("componentType", option.missingFields)
        self.assertEqual(option.seatState, "UNKNOWN")

    def test_duplicate_native_offering_updates_one_record_without_losing_latest_seats(self):
        payload = {"schemaVersion": "1.5.0", "courses": [{"courseCode": "CSE4001", "options": [
            {"offeringId": "native-1", "facultyName": "Faculty A", "slot": "A11", "componentType": "Theory", "availableSeats": 2},
            {"offeringId": "native-1", "facultyName": "Faculty A", "slot": "A11", "componentType": "Theory", "availableSeats": 0, "classStatus": "Full"},
            {"offeringId": "native-2", "facultyName": "Faculty B", "slot": "B11", "componentType": "Theory", "classStatus": "Unavailable"},
        ]}], "possibleMatches": [{"courseCode": "CSE4001", "candidate": "CSE4002"}]}
        result = parse_vtop_data(json.dumps(payload))
        options = result.subjects[0].options
        self.assertEqual(len(options), 2)
        self.assertEqual(options[0].availableSeats, 0)
        self.assertEqual(options[0].seatState, "FULL")
        self.assertEqual(options[1].seatState, "UNKNOWN")
        self.assertEqual(options[1].classStatus, "Unavailable")
        self.assertEqual(result.possibleMatches, payload["possibleMatches"])

    def test_conflicting_duplicate_offering_id_is_retained_as_ambiguous(self):
        payload = {"schemaVersion": "1.5.0", "courses": [{"courseCode": "CSE4002", "options": [
            {"offeringId": "duplicate-id", "facultyName": "Faculty A", "slot": "A11", "componentType": "Theory", "availableSeats": 10},
            {"offeringId": "duplicate-id", "facultyName": "Faculty B", "slot": "B11", "componentType": "Theory", "availableSeats": 10},
        ]}]}
        result = parse_vtop_data(json.dumps(payload))
        self.assertEqual(len(result.subjects[0].options), 2)
        self.assertEqual([option.offeringId for option in result.subjects[0].options], ["duplicate-id", "duplicate-id"])

    def test_large_v150_import_retains_every_course_and_offering(self):
        courses = [{"courseCode": f"CSE{i:04d}", "courseTitle": f"Course {i}", "options": [
            {"offeringId": f"{i}-a", "facultyName": "Faculty A", "slot": "A11", "componentType": "Theory", "availableSeats": 12},
            {"offeringId": f"{i}-b", "facultyName": "Faculty B", "slot": "B11", "componentType": "Theory", "availableSeats": None},
        ]} for i in range(300)]
        result = parse_vtop_data(json.dumps({"schemaVersion": "1.5.0", "source": "FFCS_OS_VTOP_EXTENSION", "courses": courses}))
        self.assertEqual(result.errors, [])
        self.assertEqual(len(result.subjects), 300)
        self.assertEqual(result.totalParsed, 600)
        self.assertEqual(result.validIncompleteRecords, 600)
        self.assertEqual(result.optimizerCompatibleRecords, 0)
        self.assertTrue(all(len(course.options) == 2 for course in result.subjects))


if __name__ == "__main__":
    unittest.main()
