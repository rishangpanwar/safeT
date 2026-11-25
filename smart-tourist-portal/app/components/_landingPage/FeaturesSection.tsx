import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Shield, 
  Map, 
  UserPlus, 
  AlertTriangle, 
  Smartphone, 
  Database,
  Users,
  Globe,
  Bell
} from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Autonomous Health Guardian",
    description: "An unsupervised Isolation Forest scores heart rate, HRV, SpO₂, temperature and motion every second to catch silent physiological collapse.",
  },
  {
    icon: AlertTriangle,
    title: "Fall & Impact Detection",
    description: "A four-stage biomechanical engine (free fall, impact, rebound, immobility) raises a 30-second \"Are you OK?\" check, then escalates automatically.",
  },
  {
    icon: Bell,
    title: "MEWS Clinical Triage",
    description: "Vitals are converted into Modified Early Warning Scores and Green / Yellow / Red acuity tiers, so the command centre sees one clear priority.",
  },
  {
    icon: Map,
    title: "Geo-Medical Risk Zones",
    description: "Ray-casting geofences over hypoxia corridors, avalanche and landslide zones lower alert thresholds where terrain makes tourists vulnerable.",
  },
  {
    icon: Smartphone,
    title: "Offline Store-and-Forward",
    description: "An on-device SQLite buffer keeps triage running in cellular shadow zones and burst-syncs vitals and emergencies when signal returns.",
  },
  {
    icon: UserPlus,
    title: "Soulbound Health ID",
    description: "ERC-5192 permits anchor only SHA-256 hashes. A signed, encrypted Emergency QR gives paramedics blood group and allergies on the spot.",
  },
];

const FeaturesSection = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Comprehensive Safety Features</h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Our platform combines cutting-edge technology with proven safety protocols to provide unmatched tourist protection and monitoring capabilities.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="group hover:shadow-elegant transition-all duration-300 hover:-translate-y-1 bg-gradient-card border border-border/50 rounded-2xl">
              <CardHeader className="pb-4">
                <div className="w-12 h-12 bg-gradient-feature rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl font-semibold">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Additional stats */}
        <div className="mt-20 bg-gradient-feature rounded-2xl p-8 border border-primary/10">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="space-y-2">
              <div className="flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <div className="text-3xl font-bold text-primary">50,000+</div>
              <div className="text-muted-foreground">Active Tourist Profiles</div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-center mb-4">
                <Globe className="w-8 h-8 text-primary" />
              </div>
              <div className="text-3xl font-bold text-primary">150+</div>
              <div className="text-muted-foreground">Monitored Destinations</div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-primary" />
              </div>
              <div className="text-3xl font-bold text-primary">99.8%</div>
              <div className="text-muted-foreground">Alert Success Rate</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;