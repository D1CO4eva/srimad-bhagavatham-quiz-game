import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const quiz = await db.quiz.create({
    data: {
      title: "Srimad Bhagavatam: Canto 1 Basics",
      description: "A sample warm-up quiz for testing the live game flow.",
      questions: {
        create: [
          {
            order: 0,
            type: "MULTIPLE_CHOICE",
            question: "Who narrated the Srimad Bhagavatam to Maharaja Parikshit?",
            choices: ["Sage Vyasadeva", "Sage Narada", "Sukadeva Gosvami", "Sage Vasistha"],
            answer: "Sukadeva Gosvami",
            explanation: "Sukadeva Gosvami recited the Bhagavatam to Parikshit Maharaja in his final seven days.",
            timeLimitSecs: 20,
          },
          {
            order: 1,
            type: "MULTIPLE_CHOICE",
            question: "How many cantos (skandhas) does the Srimad Bhagavatam have?",
            choices: ["10", "12", "18", "24"],
            answer: "12",
            explanation: "The Bhagavatam is traditionally divided into twelve cantos.",
            timeLimitSecs: 20,
          },
          {
            order: 2,
            type: "TRUE_FALSE",
            question: "Maharaja Parikshit was cursed to die within seven days.",
            choices: ["True", "False"],
            answer: "True",
            explanation: "The curse of Sringi is what prompted Parikshit to hear the Bhagavatam before his death.",
            timeLimitSecs: 15,
          },
          {
            order: 3,
            type: "MULTIPLE_CHOICE",
            question: "Srimad Bhagavatam is considered a commentary on which Vedic text?",
            choices: ["Bhagavad Gita", "Vedanta Sutra", "Isopanisad", "Manu Smriti"],
            answer: "Vedanta Sutra",
            explanation: "The Bhagavatam is traditionally regarded as Vyasadeva's own natural commentary on the Vedanta Sutra.",
            timeLimitSecs: 20,
          },
        ],
      },
    },
  });

  console.log(`Seeded quiz ${quiz.id}: ${quiz.title}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
