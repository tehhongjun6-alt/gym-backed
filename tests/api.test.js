const request = require("supertest");

const mockQuery = jest.fn();
const mockGetUser = jest.fn();
const mockStorageFrom = jest.fn();

jest.mock("../db", () => ({
    pool: {
        query: mockQuery,
    },
}));

jest.mock("../supabaseClient", () => ({
    supabase: {
        auth: {
            getUser: mockGetUser,
        },
    },
    supabaseAdmin: {
        storage: {
            from: mockStorageFrom,
        },
    },
}));

process.env.API_NINJAS_KEY = "test-ninjas-key";
process.env.USDA_API_KEY = "test-usda-key";
process.env.DOTENV_CONFIG_QUIET = "true";

const app = require("../index");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function authenticated(testRequest) {
    return testRequest.set("Authorization", "Bearer valid-test-token");
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGetUser.mockResolvedValue({
        data: {
            user: {
                id: USER_ID,
                email: "athlete@example.com",
            },
        },
        error: null,
    });

    global.fetch = jest.fn();
});

afterAll(() => {
    delete global.fetch;
});

describe("authentication", () => {
    test("rejects a protected request without an access token", async () => {
        const response = await request(app).get("/workouts");

        expect(response.status).toBe(401);
        expect(response.body).toEqual({
            error: "Access token is required",
        });
        expect(mockQuery).not.toHaveBeenCalled();
    });
});

describe("workout CRUD and ownership", () => {
    const workout = {
        id: 7,
        user_id: USER_ID,
        workout_date: "2026-10-30",
        body_part: "chest",
        exercise_name: "Bench Press",
        sets: 4,
        reps: 8,
        weight: 60,
    };

    test("creates a workout for the signed-in user", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [workout] });

        const response = await authenticated(
            request(app).post("/workouts")
        ).send({
            workout_date: "2026-10-30",
            body_part: "chest",
            exercise_name: "Bench Press",
            sets: 4,
            reps: 8,
            weight: 60,
        });

        expect(response.status).toBe(201);
        expect(response.body).toEqual(workout);
        expect(mockQuery.mock.calls[0][1]).toEqual([
            USER_ID,
            "2026-10-30",
            "chest",
            "Bench Press",
            4,
            8,
            60,
        ]);
    });

    test("updates a workout owned by the signed-in user", async () => {
        const updatedWorkout = { ...workout, reps: 10 };
        mockQuery.mockResolvedValueOnce({ rows: [updatedWorkout] });

        const response = await authenticated(
            request(app).patch("/workouts/7")
        ).send({ reps: 10 });

        expect(response.status).toBe(200);
        expect(response.body.reps).toBe(10);
        expect(mockQuery.mock.calls[0][1]).toEqual([
            null,
            null,
            null,
            undefined,
            10,
            undefined,
            7,
            USER_ID,
        ]);
    });

    test("returns 404 when updating a workout not owned by the user", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const response = await authenticated(
            request(app).patch("/workouts/99")
        ).send({ reps: 10 });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Workout not found");
        expect(mockQuery.mock.calls[0][1].slice(-2)).toEqual([99, USER_ID]);
    });

    test("deletes a workout owned by the signed-in user", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });

        const response = await authenticated(
            request(app).delete("/workouts/7")
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: "Workout deleted successfully",
            id: 7,
        });
        expect(mockQuery.mock.calls[0][1]).toEqual([7, USER_ID]);
    });

    test("returns 404 when deleting a workout not owned by the user", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const response = await authenticated(
            request(app).delete("/workouts/99")
        );

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Workout not found");
        expect(mockQuery.mock.calls[0][1]).toEqual([99, USER_ID]);
    });
});

describe("posts", () => {
    test("creates a post for the signed-in user", async () => {
        const post = {
            id: 3,
            author_id: USER_ID,
            content: "Morning workout",
            visibility: "friends-only",
            image_url: null,
            image_path: null,
        };
        mockQuery.mockResolvedValueOnce({ rows: [post] });

        const response = await authenticated(
            request(app).post("/posts")
        ).send({
            content: " Morning workout ",
            visibility: "friends-only",
        });

        expect(response.status).toBe(201);
        expect(response.body).toEqual(post);
        expect(mockQuery.mock.calls[0][1]).toEqual([
            USER_ID,
            "Morning workout",
            "friends-only",
            null,
            null,
        ]);
    });

    test("returns posts visible to the signed-in user", async () => {
        const posts = [
            {
                id: 3,
                author_id: OTHER_USER_ID,
                author: "training_friend",
                content: "Leg day",
                visibility: "friends-only",
                image_path: null,
            },
        ];
        mockQuery.mockResolvedValueOnce({ rows: posts });

        const response = await authenticated(request(app).get("/posts"));

        expect(response.status).toBe(200);
        expect(response.body).toEqual(posts);
        expect(mockQuery.mock.calls[0][1]).toEqual([USER_ID]);
    });
});

describe("friends", () => {
    test("sends a friend request", async () => {
        const friendship = {
            id: 5,
            requester_id: USER_ID,
            receiver_id: OTHER_USER_ID,
            status: "pending",
        };

        mockQuery
            .mockResolvedValueOnce({
                rows: [{ id: OTHER_USER_ID, username: "training_friend" }],
            })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [friendship] });

        const response = await authenticated(
            request(app).post("/friend-requests")
        ).send({ receiver_id: OTHER_USER_ID });

        expect(response.status).toBe(201);
        expect(response.body).toEqual(friendship);
        expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test("accepts a pending friend request received by the user", async () => {
        const friendship = {
            id: 5,
            requester_id: OTHER_USER_ID,
            receiver_id: USER_ID,
            status: "accepted",
        };
        mockQuery.mockResolvedValueOnce({ rows: [friendship] });

        const response = await authenticated(
            request(app).patch("/friend-requests/5/accept")
        );

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("accepted");
        expect(mockQuery.mock.calls[0][1]).toEqual([
            "accepted",
            5,
            USER_ID,
            "pending",
        ]);
    });

    test("lists accepted friendships in both directions", async () => {
        const sentFriend = {
            id: OTHER_USER_ID,
            username: "training_friend",
        };
        const receivedFriend = {
            id: "33333333-3333-4333-8333-333333333333",
            username: "gym_partner",
        };

        mockQuery
            .mockResolvedValueOnce({ rows: [sentFriend] })
            .mockResolvedValueOnce({ rows: [receivedFriend] });

        const response = await authenticated(request(app).get("/friends"));

        expect(response.status).toBe(200);
        expect(response.body).toEqual([sentFriend, receivedFriend]);
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });
});

describe("exercise searches", () => {
    test("returns exercise suggestions from API Ninjas", async () => {
        const exercises = [
            {
                name: "Bench Press",
                muscle: "chest",
                difficulty: "beginner",
            },
        ];
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue(exercises),
        });

        const response = await authenticated(
            request(app).get("/exercise-suggestions?muscle=chest")
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual(exercises);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.api-ninjas.com/v1/exercises?muscle=chest",
            {
                headers: {
                    "X-Api-Key": "test-ninjas-key",
                },
            }
        );
    });

    test("filters and maps free-exercise-db image results", async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue([
                {
                    id: "bench-press",
                    name: "Bench Press",
                    level: "beginner",
                    equipment: "barbell",
                    category: "strength",
                    primaryMuscles: ["chest"],
                    secondaryMuscles: ["triceps"],
                    instructions: ["Lower the bar", "Press upward"],
                    images: ["bench-press/0.jpg"],
                },
                {
                    id: "squat",
                    name: "Squat",
                    level: "beginner",
                    equipment: "barbell",
                    category: "strength",
                    primaryMuscles: ["quadriceps"],
                    secondaryMuscles: [],
                    instructions: ["Squat down"],
                    images: ["squat/0.jpg"],
                },
            ]),
        });

        const response = await authenticated(
            request(app).get("/exercise-images?name=bench")
        );

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
            id: "bench-press",
            name: "Bench Press",
            images: [
                "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/bench-press/0.jpg",
            ],
        });
    });
});

describe("food searches", () => {
    test("maps USDA nutrition data into the frontend food format", async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                foods: [
                    {
                        fdcId: 1001,
                        description: "ORANGE, RAW",
                        brandOwner: null,
                        servingSize: 100,
                        servingSizeUnit: "g",
                        foodNutrients: [
                            {
                                nutrientName: "Energy",
                                value: 47,
                                unitName: "KCAL",
                            },
                            {
                                nutrientName: "Protein",
                                value: 0.9,
                                unitName: "G",
                            },
                            {
                                nutrientName: "Carbohydrate, by difference",
                                value: 11.8,
                                unitName: "G",
                            },
                            {
                                nutrientName: "Total lipid (fat)",
                                value: 0.1,
                                unitName: "G",
                            },
                        ],
                    },
                ],
            }),
        });

        const response = await authenticated(
            request(app).get("/food-calories?query=orange")
        );

        expect(response.status).toBe(200);
        expect(response.body[0]).toMatchObject({
            id: 1001,
            name: "ORANGE, RAW",
            calories: 47,
            protein: 0.9,
            carbohydrates: 11.8,
            fat: 0.1,
            image_url:
                "https://www.themealdb.com/images/ingredients/orange.png",
        });
        expect(global.fetch.mock.calls[0][0]).toContain(
            "api.nal.usda.gov/fdc/v1/foods/search"
        );
    });

    test("maps TheMealDB meal search results", async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                meals: [
                    {
                        idMeal: "52772",
                        strMeal: "Teriyaki Chicken",
                        strCategory: "Chicken",
                        strArea: "Japanese",
                        strMealThumb: "https://example.com/meal.jpg",
                        strInstructions: "Cook the chicken.",
                        strYoutube: "https://youtube.com/watch?v=test",
                        strIngredient1: "Chicken",
                        strMeasure1: "500 g",
                        strIngredient2: "Soy sauce",
                        strMeasure2: "2 tbsp",
                    },
                ],
            }),
        });

        const response = await authenticated(
            request(app).get("/meal-ideas?search=chicken")
        );

        expect(response.status).toBe(200);
        expect(response.body[0]).toMatchObject({
            id: "52772",
            name: "Teriyaki Chicken",
            ingredients: [
                { name: "Chicken", measure: "500 g" },
                { name: "Soy sauce", measure: "2 tbsp" },
            ],
        });
    });
});
