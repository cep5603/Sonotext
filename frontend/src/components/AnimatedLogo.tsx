import { useState } from "react"
import { motion } from "framer-motion"
import logoWhite from "@/assets/sonotext-logo-white.png"

interface AnimatedLogoProps {
    onClick?: () => void
}

const TEXT = "Sonotext"

export function AnimatedLogo({ onClick }: AnimatedLogoProps) {
    const [isHovered, setIsHovered] = useState(false)

    return (
        <motion.button
            className="flex items-center justify-center gap-2 cursor-pointer mx-auto focus:outline-none"
            onHoverStart={() => setIsHovered(true)}
            onHoverEnd={() => setIsHovered(false)}
            onClick={onClick}
            whileTap={{ scale: 0.98 }}
        >
            {/* Logo image */}
            <motion.img
                src={logoWhite}
                alt="Sonotext"
                className="h-12"
                animate={{
                    x: isHovered ? -4 : 0,
                }}
                transition={{
                    duration: 0.3,
                    ease: "easeOut",
                }}
            />

            {/* Typing text container */}
            <motion.div
                className="overflow-hidden flex items-center"
                initial={{ width: 0 }}
                animate={{
                    width: isHovered ? "auto" : 0,
                }}
                transition={{
                    duration: 0.3,
                    ease: "easeOut",
                }}
            >
                <motion.span
                    className="text-4xl tracking-tight whitespace-nowrap"
                    style={{ fontFamily: "'Fugaz One', sans-serif" }}
                    initial={{ opacity: 0 }}
                    animate={{
                        opacity: isHovered ? 1 : 0,
                    }}
                    transition={{
                        duration: 0.2,
                        delay: isHovered ? 0.1 : 0,
                    }}
                >
                    {TEXT.split("").map((char, index) => (
                        <motion.span
                            key={index}
                            className="inline-block"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{
                                opacity: isHovered ? 1 : 0,
                                y: isHovered ? [6, -4, 2, 0] : 6,
                            }}
                            transition={{
                                opacity: {
                                    duration: 0.2,
                                    delay: isHovered
                                        ? 0.05 + index * 0.05
                                        : (TEXT.length - index - 1) * 0.025,
                                    ease: "easeOut",
                                },
                                y: {
                                    duration: 0.6,
                                    delay: isHovered
                                        ? 0.05 + index * 0.05
                                        : (TEXT.length - index - 1) * 0.025,
                                    ease: [0.22, 1, 0.36, 1],
                                    times: [0, 0.35, 0.65, 1],
                                },
                            }}
                        >
                            {char}
                        </motion.span>
                    ))}
                </motion.span>
            </motion.div>
        </motion.button>
    )
}
