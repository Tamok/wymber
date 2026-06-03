export const NODE_TYPES = {
    event: {
        color: "#C8E6C9",
        icon: "circle",
        label: "Event",
        description: "A significant experience in your healing journey",
        tooltip: "Trauma incidents, flashback memories, or important life events",
        prompt: "Something that happened. Share only as much as feels okay."
    },
    emotion: {
        color: "#BBDEFB",
        icon: "heart",
        label: "Emotion",
        description: "Feelings and emotional states you've experienced",
        tooltip: "Fear, sadness, anger, joy, hope. All feelings are valid",
        prompt: "A feeling that came up. There's no wrong feeling here."
    },
    body: {
        color: "#FFCCBC",
        icon: "activity",
        label: "Body",
        description: "Physical sensations you noticed",
        tooltip: "Tension, calm, a knot in your stomach. What your body felt",
        prompt: "What did you notice in your body? Skip if you'd rather not."
    },
    person: {
        color: "#F8BBD9",
        icon: "user",
        label: "Person",
        description: "Important people in your experiences",
        tooltip: "Family, friends, therapists, or others who have been part of your journey",
        prompt: "Someone connected to this. You can use initials or a nickname."
    },
    place: {
        color: "#D7CCC8",
        icon: "map-pin",
        label: "Place",
        description: "Locations that hold significance for you",
        tooltip: "Safe spaces, challenging environments, or meaningful locations",
        prompt: "A place that's part of this."
    },
    trigger: {
        color: "#FFE0B2",
        icon: "zap",
        label: "Trigger",
        description: "Things that bring up strong reactions or memories",
        tooltip: "Sights, sounds, situations that activate your trauma response",
        prompt: "Something that brings the feeling back. Want to add a calming anchor too?"
    },
    coping: {
        color: "#A5D6A7",
        icon: "shield",
        label: "Coping",
        description: "Strategies and skills that help you",
        tooltip: "Healthy coping mechanisms, grounding skills, therapeutic practices",
        prompt: "Something that helps you get through. Even small things count."
    },
    support: {
        color: "#B2DFDB",
        icon: "anchor",
        label: "Support",
        description: "Someone or something you can lean on",
        tooltip: "People, places, or practices that help you feel steadier",
        prompt: "Someone or something you can lean on."
    },
    need: {
        color: "#D1C4E9",
        icon: "target",
        label: "Need",
        description: "What you needed, or need now",
        tooltip: "Met or unmet needs that underlie the experience",
        prompt: "What did you need then, or need now?"
    },
    insight: {
        color: "#E1BEE7",
        icon: "lightbulb",
        label: "Insight",
        description: "Realizations and understanding you've gained",
        tooltip: "Patterns you've noticed, connections you've made, wisdom you've developed",
        prompt: "Something you've come to understand. No pressure to have answers."
    },
    growth: {
        color: "#C8F7C5",
        icon: "trending-up",
        label: "Growth",
        description: "Positive changes and healing progress",
        tooltip: "Ways you've grown, strengths you've developed, progress you've made",
        prompt: "A way you've grown or coped, however small."
    }
};

export const MESSAGES = {
    welcome: "Welcome back to your safe space for reflection and healing.",
    first_time: "Welcome to Wymber. This is your private space for mapping and understanding your experiences.",
    session_expired: "Your session has expired for security. Please log in again.",
    save_success: "Your map has been safely saved.",
    delete_confirm: "This will remove this node and its connections. You can always recreate it later if needed.",
    crisis_disclaimer: "If you're in crisis, please reach out for immediate help: Call 988 (Suicide & Crisis Lifeline) or 911."
};
