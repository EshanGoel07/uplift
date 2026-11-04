# First-visit test script (M15.9)

Run this with one person who does not know Uplift. It has not been run yet: it needs a real person.

Give them the live URL and this one instruction: "Please look around as you normally would, and think out loud." Do not explain anything. Do not help unless they are completely stuck. Note what they say, not what you hoped they would say.

Ask each question at the time shown, and write down their answer as said. A wrong answer is a finding about the site, not about the person.

| When | Ask | A pass sounds like |
|---|---|---|
| 5 seconds | What is this site about? | It studies whether setups for coding agents help them fix real bugs. |
| 30 seconds | How was the experiment built? | 77 bugs, six conditions, two repeats each, which makes 924 attempts. They can say how the numbers relate. |
| 1 minute | What did the agent get, and what was kept from it until later? | The code, the issue and its setup; the hidden tests arrived only after it had exited. |
| 2 minutes | What did the study find? | No detectable difference, which does not mean the effect is proven to be zero. |
| When they reach WINDOW | Why did some attempts work and others not? | The approach differed, and that does not prove a setup caused it. |
| On the Lattice | Point at one bug, one condition, one repeat, one outcome. | They can do it without guessing from colour alone. |
| On Research details | What are the stages of the pipeline? | They can name about five before opening the graph. |
| Any story | Scroll back two steps, then jump ahead one. | They do it without losing their place. |

Then ask:
1. What was confusing?
2. What did you skip?
3. Was anything repeated?

Keep the notes in `qa-screenshots/` or anywhere outside the repository, without the person's name.
