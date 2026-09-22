import type { PrismaClient } from './generated/prisma/client.js';
import { defaultSettings, defaultSocialTemplates } from './seed-data.js';

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  for (const template of defaultSocialTemplates) {
    await prisma.socialTemplate.upsert({
      where: {
        type_name_version: {
          type: template.type,
          name: template.name,
          version: template.version,
        },
      },
      create: template,
      update: {},
    });
  }

  for (const setting of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: setting,
      update: {},
    });
  }
}
