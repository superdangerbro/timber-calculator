ALTER TABLE "trees" ADD COLUMN "position_source" text;--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "gps_lat" double precision;--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "gps_lon" double precision;--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "gps_accuracy_m" double precision;