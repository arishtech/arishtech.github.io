<?php
/**
 * Pholio's Custom Nav Walker
 * https://github.com/twittem/wp-bootstrap-navwalker
 */
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

if ( ! class_exists( 'restly_Nav_Walker' ) ):

class restly_Nav_Walker extends Walker_Nav_Menu {

	// taken from wp_bootstrap_navwalker
	public static function fallback( $args ) {
		if ( current_user_can( 'manage_options' ) ) {
			extract( $args );
			$fb_output = null;
			if ( $container ) {
				$fb_output = '<' . esc_attr($container);
				if ( $container_id )
					$fb_output .= ' id="' . esc_attr($container_id) . '"';
				if ( $container_class )
					$fb_output .= ' class="' . esc_attr($container_class) . '"';
				$fb_output .= '>';
			}
			$fb_output .= '<ul';
			if ( $menu_id )
				$fb_output .= ' id="' . esc_attr($menu_id) . '"';
			if ( $menu_class )
				$fb_output .= ' class="' . esc_attr($menu_class) . '"';
			$fb_output .= '>';
			$fb_output .= '<li><a href="' . esc_url(admin_url( 'nav-menus.php' )) . '">'. esc_html__('Set Main Menu','restly') .'</a></li>';
			$fb_output .= '</ul>';
			if ( $container )
				$fb_output .= '</' . esc_attr($container) . '>';
			echo wp_kses($fb_output,'restly_allowed_html');
		}
	}
}

endif;