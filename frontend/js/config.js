export const NODE_TYPES = {
    event: {
        color: "#C8E6C9",
        icon: "circle",
        label: "Event",
        description: "A significant experience in your healing journey",
        tooltip: "Trauma incidents, flashback memories, or important life events"
    },
    emotion: {
        color: "#BBDEFB",
        icon: "heart",
        label: "Emotion",
        description: "Feelings and emotional states you've experienced",
        tooltip: "Fear, sadness, anger, joy, hope - all feelings are valid"
    },
    person: {
        color: "#F8BBD9",
        icon: "user",
        label: "Person",
        description: "Important people in your experiences",
        tooltip: "Family, friends, therapists, or others who have been part of your journey"
    },
    place: {
        color: "#D7CCC8",
        icon: "map-pin",
        label: "Place",
        description: "Locations that hold significance for you",
        tooltip: "Safe spaces, challenging environments, or meaningful locations"
    },
    trigger: {
        color: "#FFE0B2",
        icon: "zap",
        label: "Trigger",
        description: "Things that bring up strong reactions or memories",
        tooltip: "Sights, sounds, situations that activate your trauma response"
    },
    coping: {
        color: "#A5D6A7",
        icon: "shield",
        label: "Coping",
        description: "Strategies and resources that help you",
        tooltip: "Healthy coping mechanisms, support systems, therapeutic practices"
    },
    insight: {
        color: "#E1BEE7",
        icon: "lightbulb",
        label: "Insight",
        description: "Realizations and understanding you've gained",
        tooltip: "Patterns you've noticed, connections you've made, wisdom you've developed"
    },
    growth: {
        color: "#C8F7C5",
        icon: "trending-up",
        label: "Growth",
        description: "Positive changes and healing progress",
        tooltip: "Ways you've grown, strengths you've developed, progress you've made"
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
