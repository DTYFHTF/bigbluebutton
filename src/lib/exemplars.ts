import type { ModeId } from "./modes";
import type { Example } from "./prompt";

// Short before/after pairs shown to small models as example exchanges. Small
// models copy a demonstrated transformation far more reliably than they
// follow a written rule. These must never overlap eval/passages.json, or
// evals would measure memorisation.
const EXEMPLARS: Partial<Record<ModeId, Example[]>> = {
  humanize: [
    {
      input:
        "Effective time management is a crucial skill that plays a pivotal role in professional success. By leveraging tools such as calendars and to-do lists, individuals can streamline their workflows and enhance their overall productivity. Moreover, prioritizing tasks ensures that important deadlines are consistently met.",
      output:
        "Good time management goes a long way toward doing well at work. Simple tools like a calendar and a to-do list keep your day in order and help you get more done. And when you tackle the most important tasks first, the deadlines that matter stop slipping.",
    },
    {
      input:
        "Our team is excited to announce the launch of our new mobile app, which offers a seamless and intuitive user experience. With a wide range of innovative features, the app empowers users to manage their finances effortlessly. We look forward to hearing your valuable feedback.",
      output:
        "We've just launched our new mobile app, and we're pretty excited about it. It's easy to find your way around, and it comes with a lot of new tools for keeping on top of your money without the usual hassle. Give it a try and tell us what you think.",
    },
  ],
  standard: [
    {
      input:
        "The city council approved a plan to expand the bike lane network by 40 kilometres over the next three years. Officials said the project would be funded through a mix of federal grants and local taxes.",
      output:
        "City councillors have signed off on adding 40 kilometres to the bike lane network over the coming three years. According to officials, the money will come partly from federal grants and partly from local taxes.",
    },
  ],
  fluency: [
    {
      input:
        "Me and my colleague has been working on this report since two weeks, and we was hoping to finish it before the friday deadline.",
      output:
        "My colleague and I have been working on this report for two weeks, and we were hoping to finish it before the Friday deadline.",
    },
  ],
  formal: [
    {
      input:
        "Hey, just a heads up that the meeting got pushed to Thursday because half the team's out sick. Grab me if you've got questions.",
      output:
        "Please note that the meeting has been moved to Thursday, as roughly half of the team is currently unwell. Please contact me if you have any questions.",
    },
  ],
  academic: [
    {
      input:
        "Kids who read a lot at home tend to do better at school, but it's hard to say if reading causes it or if other stuff like family income matters more.",
      output:
        "Children who read frequently at home tend to achieve better academic outcomes; however, it remains unclear whether reading itself drives this association or whether other factors, such as household income, play a larger role.",
    },
  ],
  simple: [
    {
      input:
        "The pharmaceutical company announced that its novel therapeutic demonstrated statistically significant efficacy in reducing symptom severity among participants in a phase III clinical trial.",
      output:
        "A drug company says its new medicine worked in a large, late-stage study. People who took it had milder symptoms, and the difference was big enough that it was unlikely to be down to chance.",
    },
  ],
  creative: [
    {
      input: "The old library was quiet in the evening. A few students studied at the long tables while rain fell outside.",
      output:
        "By evening the old library had gone still. A handful of students bent over the long tables, and outside, the rain kept up its steady tapping.",
    },
  ],
  shorten: [
    {
      input:
        "In order to ensure that all employees are able to access the new system, we are going to be holding a number of training sessions over the course of the next few weeks, and we would encourage everyone to sign up for one of them as soon as they possibly can.",
      output: "We'll run training sessions on the new system over the next few weeks. Please sign up for one soon.",
    },
  ],
  expand: [
    {
      input: "Regular exercise improves sleep.",
      output:
        "Exercising regularly tends to improve sleep. People who stay active often find it easier to fall asleep at night, and the sleep they get is usually deeper and less broken.",
    },
  ],
};

export function builtinExemplars(mode: ModeId): Example[] {
  return EXEMPLARS[mode] ?? [];
}

export function allExemplars(): Example[] {
  return Object.values(EXEMPLARS).flat();
}
